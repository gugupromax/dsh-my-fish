"""Cookie reaches this process over stdin only; stdout contains normalized data, never credentials."""
import asyncio
import json
import sys
import traceback
from pathlib import Path

def public_error(error):
    name = type(error).__name__
    code, message = 'request_failed', 'X 接口未返回可用结果，请查看体检错误类型。'
    if isinstance(error, ImportError):
        code, message = 'dependency_missing', '插件依赖缺失或无法导入，请重新运行依赖准备脚本。'
    elif name == 'TooManyRequests':
        code, message = 'rate_limit', 'X 返回限流，已暂停，请稍后人工检查。'
    elif name in ('Unauthorized', 'Forbidden', 'AccountLocked', 'AccountSuspended'):
        code, message = 'auth_or_restriction', 'X 登录失效或账号受限，请在浏览器核对账号状态和 Cookie。'
    elif name in ('TimeoutException', 'ReadTimeout', 'ConnectTimeout', 'ConnectError', 'ReadError', 'WriteError', 'RemoteProtocolError'):
        code, message = 'network_uncertain', '无法连接 X，请检查插件代理地址及本机网络；不会自动重发写操作。'
    elif name == 'NotFound':
        code, message = 'client_incompatible', 'X 读取接口返回 404，当前客户端尚未稳定适配；本次读取已停止，这不等于 Cookie 错误。'
    elif str(error) in ("Couldn't get KEY_BYTE indices", "Couldn't get key from the page source", 'invalid response'):
        code, message = 'client_incompatible', 'X 网页结构与当前 Cookie 客户端不兼容，尚未完成账号核验；这不等于 Cookie 错误。'
    result = {'code': code, 'kind': name, 'message': message}
    frames = traceback.extract_tb(error.__traceback__)
    if frames:
        last = frames[-1]
        result['origin'] = {'file': Path(last.filename).name, 'line': last.lineno, 'function': last.name}
    return result

async def credential_boundary(request):
    # Twikit flattens cookie domains internally. Keep auth headers off public CDN requests.
    host = request.url.host
    if request.url.scheme != 'https' or host not in {'x.com', 'api.x.com', 'twitter.com', 'abs.twimg.com', 'pbs.twimg.com'} or request.url.port not in (None, 443):
        raise ValueError('unexpected destination')
    if host not in {'x.com', 'api.x.com'}:
        for key in ('cookie', 'authorization', 'x-csrf-token'):
            request.headers.pop(key, None)

def normalize_user_entities(value):
    """X omits empty biography URL entities; do not invent any identity fields."""
    if isinstance(value, list):
        for item in value: normalize_user_entities(item)
    elif isinstance(value, dict):
        legacy = value.get('legacy')
        if value.get('rest_id') and isinstance(legacy, dict) and 'screen_name' in legacy:
            entities = legacy.setdefault('entities', {})
            if isinstance(entities, dict):
                description = entities.setdefault('description', {})
                if isinstance(description, dict): description.setdefault('urls', [])
        for item in value.values(): normalize_user_entities(item)
    return value

def tweet(t):
    u = getattr(t, 'user', None)
    return {'id': str(t.id), 'text': str(getattr(t, 'text', '') or ''),
            'author': getattr(u, 'screen_name', ''),
            'url': f'https://x.com/{getattr(u, "screen_name", "i")}/status/{t.id}',
            'createdAt': getattr(t, 'created_at', ''),
            'links': [v.get('expanded_url', '') for v in (getattr(t, 'urls', None) or []) if isinstance(v, dict)],
            'likes': getattr(t, 'favorite_count', 0)}

async def current_operation(client, name):
    from operation_compat import discover_operation
    transaction = client.client_transaction
    headers = {'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
               'Referer': 'https://x.com/', 'User-Agent': client._user_agent}
    if not transaction.home_page_response:
        await transaction.init(client.http, headers)
    return await discover_operation(transaction, client.http, headers, name)

async def run(req):
    from twikit import Client
    class CompatibleClient(Client):
        async def request(self, *args, **kwargs):
            data, response = await super().request(*args, **kwargs)
            return normalize_user_entities(data), response
    client = CompatibleClient('en-US', proxy=req.get('proxy') or None, timeout=30,
                    event_hooks={'request': [credential_boundary]})
    if hasattr(client, 'client_transaction'):
        from transaction_compat import CompatibleClientTransaction
        client.client_transaction = CompatibleClientTransaction()
    client.set_cookies(req['cookies'])
    op, a = req['operation'], req.get('args', {})
    if op == 'identity':
        # Settings is bound to the authenticated account. Resolve that exact handle;
        # avoid Twikit.user()'s redundant, deprecated UserByRestId operation.
        settings, _ = await client.v11.settings()
        username = settings.get('screen_name')
        if not isinstance(username, str) or not username:
            raise ValueError('authenticated username missing')
        response, _ = await client.gql.user_by_screen_name(username)
        data = response.get('data', {}).get('user', {}).get('result', {})
        legacy = data.get('legacy', {})
        actual = legacy.get('screen_name') or data.get('core', {}).get('screen_name')
        if not data.get('rest_id') or not actual or actual.lower() != username.lower():
            raise ValueError('authenticated identity could not be confirmed')
        return {'id': str(data['rest_id']), 'username': actual,
                'name': legacy.get('name') or data.get('core', {}).get('name') or actual}
    if op == 'search':
        from twikit.constants import FEATURES
        from post_data import raw_posts
        count = a.get('count', 10)
        descriptor = await current_operation(client, 'SearchTimeline')
        features = {key: FEATURES.get(key, False) for key in descriptor['features']}
        response, _ = await client.gql.gql_get(descriptor['url'],
            {'rawQuery': a['query'], 'product': 'Latest', 'count': count, 'querySource': 'typed_query'}, features)
        if response.get('errors'):
            raise RuntimeError('X rejected the search operation')
        return raw_posts(response, count)
    if op == 'timeline':
        from twikit.constants import FEATURES
        from twikit.client.gql import Endpoint
        from post_data import raw_posts
        descriptor = await current_operation(client, 'HomeLatestTimeline')
        Endpoint.HOME_LATEST_TIMELINE = descriptor['url']
        for key in descriptor['features']: FEATURES.setdefault(key, False)
        response, _ = await client.gql.home_latest_timeline(a.get('count', 10), [], None)
        if response.get('errors'): raise RuntimeError('X rejected the timeline operation')
        return raw_posts(response, a.get('count', 10))
    if op == 'read':
        from twikit.constants import FEATURES
        from twikit.client.gql import Endpoint
        from post_data import raw_posts
        descriptor = await current_operation(client, 'TweetDetail')
        Endpoint.TWEET_DETAIL = descriptor['url']
        for key in descriptor['features']: FEATURES.setdefault(key, False)
        response, _ = await client.gql.tweet_detail(a['id'], None)
        if response.get('errors'): raise RuntimeError('X rejected the post-read operation')
        matches = [post for post in raw_posts(response, 100) if post['id'] == a['id']]
        if not matches: raise RuntimeError('X did not return the requested post')
        return matches[0]
    if op == 'bookmark':
        response = await client.bookmark_tweet(a['id'])
        response.raise_for_status()
        body = response.json()
        if body.get('errors'):
            raise RuntimeError('bookmark API rejected operation')
        value = body.get('data', {}).get('tweet_bookmark_put')
        if value != 'Done':
            raise RuntimeError('bookmark acknowledgement missing')
        return {'id': a['id'], 'acknowledged': True}
    if op in ('reply', 'mention'):
        return tweet(await client.create_tweet(text=a['text'], reply_to=a.get('replyTo')))
    raise ValueError('unsupported operation')

def main():
    try:
        request = json.load(sys.stdin)
        result = asyncio.run(run(request))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as error:
        # Upstream exception text may contain request headers. Do not serialize it.
        print(json.dumps({'ok': False, 'error': public_error(error)}, ensure_ascii=False))
        return 1
    return 0

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')
    raise SystemExit(main())
