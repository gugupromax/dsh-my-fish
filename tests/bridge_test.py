import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).parents[1] / 'bridge' / 'x_client.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class Response:
    payload = {'data': {'tweet_bookmark_put': 'Done'}}
    def raise_for_status(self): pass
    def json(self): return self.payload

class FakeClient:
    requests = []
    def __init__(self, *args, **kwargs):
        async def settings(): return {'screen_name': 'fixture_bot'}, None
        async def by_name(username): return {'data': {'user': {'result': {'rest_id': '99999', 'legacy': {'screen_name': username, 'name': 'Fixture Assistant'}}}}}, None
        self.v11 = SimpleNamespace(settings=settings)
        self.gql = SimpleNamespace(user_by_screen_name=by_name)
    def set_cookies(self, cookies): self.cookies = cookies
    async def bookmark_tweet(self, tweet_id):
        self.requests.append(('bookmark', tweet_id))
        return Response()
    async def user(self): return SimpleNamespace(id='99999', screen_name='fixture_bot', name='Fixture Assistant')
    async def create_tweet(self, **kwargs):
        self.requests.append(('create', kwargs))
        return SimpleNamespace(id='123456', text=kwargs['text'], user=SimpleNamespace(screen_name='fixture_bot'))

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.old = sys.modules.get('twikit')
        sys.modules['twikit'] = SimpleNamespace(Client=FakeClient)
        FakeClient.requests = []
        Response.payload = {'data': {'tweet_bookmark_put': 'Done'}}
    def tearDown(self):
        if self.old is None: sys.modules.pop('twikit', None)
        else: sys.modules['twikit'] = self.old
    def call(self, operation, args=None):
        return asyncio.run(bridge.run({'operation': operation, 'args': args or {}, 'cookies': {'auth_token': 'fake', 'ct0': 'fake'}}))
    def test_identity_returns_no_cookie(self):
        self.assertEqual(self.call('identity'), {'id': '99999', 'username': 'fixture_bot', 'name': 'Fixture Assistant'})
    def test_reply_passes_correct_parent_and_returns_permalink(self):
        result = self.call('reply', {'text': '测试', 'replyTo': '55555'})
        self.assertEqual(FakeClient.requests[0][1]['reply_to'], '55555')
        self.assertEqual(result['url'], 'https://x.com/fixture_bot/status/123456')
    def test_bookmark_requires_actual_acknowledgement(self):
        self.assertTrue(self.call('bookmark', {'id': '55555'})['acknowledged'])
        Response.payload = {'data': {}}
        with self.assertRaises(RuntimeError): self.call('bookmark', {'id': '55555'})
    def test_bookmark_graphql_error_does_not_pass_as_http_success(self):
        Response.payload = {'errors': [{'message': 'failed'}]}
        with self.assertRaises(RuntimeError): self.call('bookmark', {'id': '55555'})
    def test_unsupported_operations_are_not_exposed(self):
        with self.assertRaises(ValueError): self.call('delete')
    def test_cookie_headers_never_reach_cdn_or_unexpected_hosts(self):
        request = SimpleNamespace(url=SimpleNamespace(host='abs.twimg.com', scheme='https', port=None),
                                  headers={'cookie': 'secret', 'authorization': 'secret', 'x-csrf-token': 'secret'})
        asyncio.run(bridge.credential_boundary(request))
        self.assertEqual(request.headers, {})
        request.url.host = 'evil.example'
        with self.assertRaises(ValueError): asyncio.run(bridge.credential_boundary(request))
    def test_public_errors_never_echo_upstream_secrets(self):
        result = bridge.public_error(Exception('auth_token=PRIVATE_VALUE'))
        self.assertNotIn('PRIVATE_VALUE', str(result))
        self.assertEqual(bridge.public_error(Exception("Couldn't get KEY_BYTE indices"))['code'], 'client_incompatible')
    def test_missing_biography_entities_does_not_change_identity_or_tweet_content(self):
        profile = {'rest_id': '99999', 'legacy': {'screen_name': 'fixture_bot', 'name': 'Fixture Assistant'}}
        raw = {'items': [profile], 'tweet': {'rest_id': '11111', 'legacy': {'full_text': '原文不变'}}}
        bridge.normalize_user_entities(raw)
        self.assertEqual(profile['legacy']['entities']['description']['urls'], [])
        self.assertEqual(profile['rest_id'], '99999')
        self.assertEqual(profile['legacy']['screen_name'], 'fixture_bot')
        self.assertNotIn('entities', raw['tweet']['legacy'])

if __name__ == '__main__': unittest.main()
