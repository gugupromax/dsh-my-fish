import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('operation_compat', Path(__file__).parents[1] / 'bridge' / 'operation_compat.py')
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)

MAIN = 'https://abs.twimg.com/responsive-web/client-web/main.abcdef0123456789a.js'
OP = '{queryId:"abcdefghijklmnopqrstuv",operationName:"SearchTimeline",operationType:"query",metadata:{featureSwitches:["first_flag","second_flag"],fieldToggles:[]}}'

class OperationTests(unittest.TestCase):
    def test_selects_only_fixed_main_bundle(self):
        self.assertEqual(compat.main_bundle_url(f'<script src="https://abs.twimg.com/responsive-web/client-web/vendor.abcdefa.js"></script><script src="{MAIN}"></script>'), MAIN)
        for url in ('https://evil.example/main.abcdefa.js', 'http://abs.twimg.com/responsive-web/client-web/main.abcdefa.js', MAIN+'?token=1', 'https://abs.twimg.com.evil.example/responsive-web/client-web/main.abcdefa.js'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                compat.main_bundle_url(f'<script src="{url}"></script>')
    def test_ambiguous_main_fails(self):
        with self.assertRaises(ValueError):
            compat.main_bundle_url(f'<script src="{MAIN}"></script><script src="{MAIN.replace("abcdef", "123456")}"></script>')
    def test_parses_operation_id_and_features_without_executing_js(self):
        result = compat.parse_operation('throw Error("do not execute");module.exports='+OP+';window.dangerous();', 'SearchTimeline')
        self.assertEqual(result['queryId'], 'abcdefghijklmnopqrstuv')
        self.assertEqual(result['features'], ['first_flag', 'second_flag'])
        self.assertEqual(result['url'], 'https://x.com/i/api/graphql/abcdefghijklmnopqrstuv/SearchTimeline')
    def test_quoted_keys_reversed_order_and_nested_metadata(self):
        source = '''exports.foo = {"metadata":{"featureSwitches":["flag_one"],"fieldToggles":[]},"operationName":"SearchTimeline","queryId":"abcdefgh_123456","operationType":"query"};'''
        self.assertEqual(compat.parse_operation(source, 'SearchTimeline')['features'], ['flag_one'])
    def test_ambiguous_missing_or_malformed_material_fails(self):
        for text in ('nothing', OP.replace('featureSwitches:["first_flag","second_flag"]', 'featureSwitches:readSecrets()'), OP+';'+OP.replace('abcdefghijklmnopqrstuv','different_operation_id'), OP.replace('featureSwitches:["first_flag","second_flag"]', 'featureSwitches:[12]')):
            with self.subTest(text=text), self.assertRaises(ValueError):
                compat.parse_operation(text, 'SearchTimeline')
    def test_nonwhitelisted_operation_is_rejected(self):
        with self.assertRaises(ValueError):
            compat.parse_operation(OP.replace('SearchTimeline','CreateTweet'), 'CreateTweet')
    def test_readonly_tweet_detail_is_allowed(self):
        result = compat.parse_operation(OP.replace('SearchTimeline','TweetDetail'), 'TweetDetail')
        self.assertEqual(result['operationName'], 'TweetDetail')
        self.assertTrue(result['url'].endswith('/TweetDetail'))
        self.assertEqual(result['features'], ['first_flag', 'second_flag'])
    def test_readonly_latest_timeline_is_allowed(self):
        result = compat.parse_operation(OP.replace('SearchTimeline','HomeLatestTimeline'), 'HomeLatestTimeline')
        self.assertEqual(result['operationName'], 'HomeLatestTimeline')
        self.assertTrue(result['url'].endswith('/HomeLatestTimeline'))
        self.assertEqual(result['features'], ['first_flag', 'second_flag'])
    def test_discovery_fetches_public_asset_without_credentials(self):
        class Session:
            calls = []
            async def request(self, **kwargs):
                self.calls.append(kwargs)
                return SimpleNamespace(text='module.exports='+OP, raise_for_status=lambda: None)
        session = Session()
        transaction = SimpleNamespace(home_page_response=f'<script src="{MAIN}"></script>')
        result = asyncio.run(compat.discover_operation(transaction, session, {'Cookie':'secret','Authorization':'secret','X-CSRF-Token':'secret','User-Agent':'test'}))
        self.assertEqual(session.calls, [{'method':'GET','url':MAIN,'headers':{'User-Agent':'test'}}])
        self.assertEqual(result['sourceUrl'], MAIN)
    def test_http_denial_stops(self):
        class Session:
            async def request(self, **kwargs):
                def denied(): raise RuntimeError('HTTP 403')
                return SimpleNamespace(text='module.exports='+OP, raise_for_status=denied)
        with self.assertRaises(RuntimeError):
            asyncio.run(compat.discover_operation(SimpleNamespace(home_page_response=f'<script src="{MAIN}"></script>'), Session(), {}))

if __name__ == '__main__': unittest.main()
