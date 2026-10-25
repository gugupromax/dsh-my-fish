import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('post_data', Path(__file__).parents[1] / 'bridge' / 'post_data.py')
post_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(post_data)

def fixture(tweet_id='100000', text='A useful post', username='fixture_bot'):
    return {'__typename': 'Tweet', 'rest_id': tweet_id,
            'legacy': {'full_text': text, 'created_at': 'Sun Oct 25', 'favorite_count': 7,
                       'entities': {'urls': [{'expanded_url': 'https://example.org/original'}]}},
            'core': {'user_results': {'result': {'__typename': 'User', 'legacy': {'screen_name': username}}}}}

class PostDataTests(unittest.TestCase):
    def test_visibility_wrapper_and_note_text_override_legacy(self):
        raw = fixture()
        raw['note_tweet'] = {'note_tweet_results': {'result': {'text': 'A complete long note'}}}
        got = post_data.raw_single({'__typename': 'TweetWithVisibilityResults', 'tweet': raw})
        self.assertEqual(got['text'], 'A complete long note')
        self.assertEqual(got['id'], '100000')
        self.assertEqual(got['author'], 'fixture_bot')
        self.assertEqual(got['url'], 'https://x.com/fixture_bot/status/100000')
        self.assertEqual(got['links'], ['https://example.org/original'])
        self.assertEqual(got['createdAt'], 'Sun Oct 25')
        self.assertEqual(got['likes'], 7)

    def test_current_user_core_screen_name_needs_no_old_optional_fields(self):
        raw = fixture()
        raw['core']['user_results']['result'] = {'core': {'screen_name': 'new_shape'}}
        self.assertEqual(post_data.raw_single(raw)['author'], 'new_shape')

    def test_recursive_search_deduplicates_and_limits(self):
        payload = {'data': {'instructions': [{'entries': [
            {'content': {'tweet_results': {'result': fixture('100001')}}},
            {'content': {'items': [{'item': {'tweet_results': {'result': fixture('100001')}}},
                                   {'item': {'tweet_results': {'result': fixture('100002')}}}]}},
            {'content': {'tweet_results': {'result': fixture('100003')}}},
        ]}]}}
        self.assertEqual([p['id'] for p in post_data.raw_posts(payload, 2)], ['100001', '100002'])

    def test_quoted_posts_are_not_independent_search_hits(self):
        raw = fixture('100001')
        raw['quoted_status_result'] = {'result': {'tweet_results': {'result': fixture('100099', 'quoted')}}}
        payload = {'items': [{'tweet_results': {'result': raw}},
                             {'quoted_status_result': {'result': {'tweet_results': {'result': fixture('100098')}}}}]}
        self.assertEqual([p['id'] for p in post_data.raw_posts(payload)], ['100001'])

    def test_missing_identity_or_text_is_not_fabricated(self):
        for raw in ({'legacy': {'full_text': 'Missing id'}}, {'rest_id': '100000'},
                    {'rest_id': '100000', 'legacy': {'full_text': ''}},
                    {'rest_id': 'invalid', 'legacy': {'full_text': 'not a tweet'}},
                    {'__typename': 'TweetUnavailable', 'rest_id': '100000', 'legacy': {'full_text': 'unavailable'}}):
            self.assertIsNone(post_data.raw_single(raw))

    def test_missing_author_uses_neutral_permalink_and_links_stay_unique(self):
        raw = fixture()
        raw['core'] = {}
        raw['legacy']['entities']['urls'] += [{'expanded_url': 'https://example.org/original'}, {}, {'expanded_url': None}]
        got = post_data.raw_single(raw)
        self.assertEqual(got['author'], '')
        self.assertEqual(got['url'], 'https://x.com/i/status/100000')
        self.assertEqual(got['links'], ['https://example.org/original'])

    def test_count_zero_and_non_tweet_branches_produce_no_posts(self):
        payload = {'tweet_results': {'result': fixture()}}
        self.assertEqual(post_data.raw_posts(payload, 0), [])
        self.assertEqual(post_data.raw_posts({'user_results': {'result': fixture()}}), [])

if __name__ == '__main__': unittest.main()
