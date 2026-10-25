import asyncio
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest

class BaseTransaction:
    def validate_response(self, value):
        if value is None:
            raise ValueError('missing page')
        return value

modules = {}
for name in ('twikit', 'twikit.x_client_transaction', 'twikit.x_client_transaction.transaction'):
    modules[name] = sys.modules.get(name)
    sys.modules[name] = ModuleType(name)
sys.modules['twikit.x_client_transaction.transaction'].ClientTransaction = BaseTransaction
try:
    spec = importlib.util.spec_from_file_location('transaction_compat', Path(__file__).parents[1] / 'bridge' / 'transaction_compat.py')
    compat = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compat)
finally:
    for name, old in modules.items():
        if old is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = old

class Response:
    text = 'parseInt(n[12],16) + parseInt(n[7], 16) + (q[3],16)'
    def raise_for_status(self):
        pass

class Session:
    def __init__(self):
        self.calls = []
    async def request(self, **kwargs):
        self.calls.append(kwargs)
        return Response()

class CompatibilityTests(unittest.TestCase):
    def test_numeric_chunk_id_binds_to_its_own_hash(self):
        page = '<script>var n={123:"other",59924:"ondemand.s"};var h={123:"deadbeef",59924:"b24a9fa951034649"};</script>'
        self.assertEqual(compat.ondemand_url(page), 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.b24a9fa951034649a.js')
    def test_old_keyed_hash_remains_supported(self):
        self.assertTrue(compat.ondemand_url('<script>{"ondemand.s":"abc1234"}</script>').endswith('ondemand.s.abc1234a.js'))
    def test_missing_or_ambiguous_chunk_material_fails_closed(self):
        for page in ('<html>logged out</html>', '{59924:"ondemand.s"}', '{59924:"ondemand.s"};{59924:"abc1234"};{59924:"def5678"}'):
            with self.subTest(page=page), self.assertRaises(ValueError):
                compat.ondemand_url(page)
    def test_indices_preserve_order_and_fail_for_empty_or_malformed(self):
        self.assertEqual(compat.byte_indices(Response.text), (12, [7, 3]))
        for source in ('nothing', 'n[12],16', 'n[12],16 + n[bad],16', 'n[256],16 + n[3],16', 'n[-1],16 + n[3],16'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                compat.byte_indices(source)
    def test_subclass_fetches_only_fixed_cdn_url_and_never_executes_script(self):
        session = Session()
        result = asyncio.run(compat.CompatibleClientTransaction().get_indices('{3:"ondemand.s"};{3:"abcdef1234567890"}', session, {'User-Agent': 'test'}))
        self.assertEqual(result, (12, [7, 3]))
        self.assertEqual(session.calls, [{'method': 'GET', 'url': 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.abcdef1234567890a.js', 'headers': {'User-Agent': 'test'}}])
    def test_http_errors_stop_without_parsing(self):
        class DeniedSession:
            async def request(self, **kwargs):
                def denied():
                    raise RuntimeError('HTTP 403')
                return SimpleNamespace(text=Response.text, raise_for_status=denied)
        with self.assertRaises(RuntimeError):
            asyncio.run(compat.CompatibleClientTransaction().get_indices('{3:"ondemand.s"};{3:"abc1234"}', DeniedSession(), {}))

if __name__ == '__main__':
    unittest.main()
