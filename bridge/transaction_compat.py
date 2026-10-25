"""Small Twikit 2.3.3 asset-discovery compatibility adapter.

Sources: https://github.com/d60/twikit/pull/411 (open upstream fix), and
https://github.com/PawiX25/twifork/blob/main/twikit/x_client_transaction/transaction.py

X now maps numeric chunk id -> name and the same id -> hash separately.
Only resource discovery and byte-index parsing are adapted. The inherited
transaction/signature calculation and X authorization remain unchanged.
Downloaded JavaScript is parsed as text, never evaluated. Missing, ambiguous,
malformed, or denied material fails closed; there are no retries or fallbacks
for authentication challenges or platform access restrictions.
"""
import re
from twikit.x_client_transaction.transaction import ClientTransaction

_CHUNK_NAME = re.compile(r'''(?:^|[,{])\s*["']?(\d+)["']?\s*:\s*["']ondemand\.s["']''', re.MULTILINE)
_OLD_HASH = re.compile(r'''["']ondemand\.s["']\s*:\s*["']([0-9a-fA-F]{6,64})["']''')
_INDEX = re.compile(r'\[\s*([^\]\r\n]{1,32})\s*\]\s*,\s*16\b')

def ondemand_url(page):
    """Resolve one unambiguous fixed-host asset from the same chunk's hash."""
    text = str(page)
    chunk_ids = set(_CHUNK_NAME.findall(text))
    hashes = set()
    if chunk_ids:
        for chunk_id in chunk_ids:
            pattern = re.compile(r'''(?:^|[,{])\s*["']?''' + re.escape(chunk_id) + r'''["']?\s*:\s*["']([0-9a-fA-F]{6,64})["']''', re.MULTILINE)
            matches = set(pattern.findall(text))
            if len(matches) != 1:
                raise ValueError('X asset chunk hash is missing or ambiguous')
            hashes.update(matches)
    else:
        hashes.update(_OLD_HASH.findall(text))
    if len(hashes) != 1:
        raise ValueError('X asset manifest is missing or ambiguous')
    return 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.' + next(iter(hashes)) + 'a.js'

def byte_indices(source):
    """Parse the newer [N], 16 call form while retaining source order."""
    indices = []
    for match in _INDEX.finditer(str(source)):
        token = match.group(1).strip()
        if not re.fullmatch(r'\d{1,3}', token) or not 0 <= int(token) <= 255:
            raise ValueError('X asset indices are malformed')
        indices.append(int(token))
    if not 2 <= len(indices) <= 64:
        raise ValueError('X asset indices are incomplete')
    return indices[0], indices[1:]

class CompatibleClientTransaction(ClientTransaction):
    """Keep the upstream algorithm; replace only get_indices discovery."""
    async def get_indices(self, home_page_response, session, headers):
        response = self.validate_response(home_page_response)
        url = ondemand_url(response)
        asset = await session.request(method='GET', url=url, headers=headers)
        asset.raise_for_status()
        return byte_indices(asset.text)
