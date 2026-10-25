"""Small, loss-aware GraphQL post projection. No Twikit model construction or I/O."""
import re


def _record(value):
    return value if isinstance(value, dict) else {}


def _at(value, *keys):
    for key in keys:
        value = _record(value).get(key)
    return value


def raw_single(result):
    """Project one known tweet result; return None for absent/deleted/incomplete posts."""
    result = _record(result)
    seen_wrappers = set()
    while result.get('__typename') == 'TweetWithVisibilityResults':
        if id(result) in seen_wrappers:
            return None
        seen_wrappers.add(id(result))
        result = _record(result.get('tweet'))
    typename = result.get('__typename')
    if typename and typename != 'Tweet':
        return None
    tweet_id = result.get('rest_id')
    if isinstance(tweet_id, bool) or not isinstance(tweet_id, (str, int)):
        return None
    tweet_id = str(tweet_id)
    if not re.fullmatch(r'[0-9]{1,25}', tweet_id):
        return None
    legacy = _record(result.get('legacy'))
    note = _record(_at(result, 'note_tweet', 'note_tweet_results', 'result'))
    text = note.get('text')
    if not isinstance(text, str) or not text.strip():
        text = legacy.get('full_text')
    if not isinstance(text, str) or not text.strip():
        return None
    user = _record(_at(result, 'core', 'user_results', 'result'))
    username = _at(user, 'legacy', 'screen_name') or _at(user, 'core', 'screen_name')
    author = username if isinstance(username, str) and re.fullmatch(r'[A-Za-z0-9_]{1,15}', username) else ''
    links = []
    for entities in (_record(legacy.get('entities')), _record(note.get('entity_set')), _record(note.get('entities'))):
        urls = entities.get('urls', [])
        if not isinstance(urls, list):
            continue
        for entity in urls:
            url = _record(entity).get('expanded_url')
            if isinstance(url, str) and url.strip() and url not in links:
                links.append(url)
    created_at = legacy.get('created_at')
    likes = legacy.get('favorite_count')
    return {
        'id': tweet_id,
        'text': text,
        'author': author,
        'url': f'https://x.com/{author or "i"}/status/{tweet_id}',
        'createdAt': created_at if isinstance(created_at, str) else '',
        'links': links,
        'likes': likes if isinstance(likes, int) and not isinstance(likes, bool) and likes >= 0 else 0,
    }


def raw_posts(payload, count=10):
    """Find tweet_results.result branches, preserving order and excluding quoted posts.

    A matched result is a boundary: never descend into that result's quoted,
    retweeted, author, or other nested objects as independent search hits.
    """
    if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
        return []
    posts, ids = [], set()

    def visit(node):
        if len(posts) >= count:
            return
        if isinstance(node, list):
            for item in node:
                visit(item)
                if len(posts) >= count:
                    return
        elif isinstance(node, dict):
            for key, value in node.items():
                if key == 'quoted_status_result':
                    continue
                if key == 'tweet_results':
                    item = raw_single(_record(value).get('result'))
                    if item and item['id'] not in ids:
                        ids.add(item['id'])
                        posts.append(item)
                else:
                    visit(value)
                if len(posts) >= count:
                    return

    visit(payload)
    return posts
