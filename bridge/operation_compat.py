"""Read current public X operation constants without executing downloaded JS.

Only SearchTimeline, TweetDetail, and HomeLatestTimeline are allowed. The caller must supply the already authenticated
ClientTransaction home_page_response; this module never reads credentials or
fetches a home page. It selects one exact abs.twimg.com main bundle and extracts
its literal queryId/operationName/metadata.featureSwitches definition. It never
falls back to guessed IDs or changes an operation's authorization.

Contract-drift reference: https://github.com/public-clis/twitter-cli/issues/78
"""
from html.parser import HTMLParser
import json
import math
import re

ALLOWED_OPERATIONS = frozenset({'SearchTimeline', 'TweetDetail', 'HomeLatestTimeline'})
_MAIN = re.compile(r'^https://abs\.twimg\.com/responsive-web/client-web/main\.[0-9a-fA-F]{6,64}\.js$')
_IDENT = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
_NUMBER = re.compile(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?')

class _Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = set()
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'script':
            for name, value in attrs:
                if name.lower() == 'src' and value and _MAIN.fullmatch(value):
                    self.sources.add(value)

def main_bundle_url(page):
    parser = _Scripts()
    parser.feed(str(page))
    if len(parser.sources) != 1:
        raise ValueError('Current X main bundle is missing or ambiguous')
    return next(iter(parser.sources))

class _Literal:
    """Bounded parser for JS object/array/scalar literals; no eval or JS runtime."""
    def __init__(self, text, start):
        self.text = text
        self.pos = start
        self.limit = min(len(text), start + 65536)
    def space(self):
        while self.pos < self.limit:
            if self.text[self.pos].isspace():
                self.pos += 1
            elif self.text.startswith('/*', self.pos):
                end = self.text.find('*/', self.pos + 2, self.limit)
                if end < 0: raise ValueError('Unterminated comment')
                self.pos = end + 2
            elif self.text.startswith('//', self.pos):
                end = self.text.find('\n', self.pos + 2, self.limit)
                self.pos = self.limit if end < 0 else end + 1
            else: break
    def string(self):
        quote = self.text[self.pos]
        self.pos += 1
        output = []
        escapes = {'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','v':'\v','0':'\0','\\':'\\','"':'"',"'":"'",'/':'/'}
        while self.pos < self.limit:
            ch = self.text[self.pos]
            self.pos += 1
            if ch == quote: return ''.join(output)
            if ch == '\\':
                if self.pos >= self.limit: break
                ch = self.text[self.pos]
                self.pos += 1
                if ch in escapes: output.append(escapes[ch])
                elif ch in ('u','x'):
                    size = 4 if ch == 'u' else 2
                    token = self.text[self.pos:self.pos+size]
                    if len(token) != size or not re.fullmatch(r'[0-9A-Fa-f]+', token): raise ValueError('Invalid escape')
                    output.append(chr(int(token,16)))
                    self.pos += size
                else: raise ValueError('Unsupported escape')
            elif ord(ch) < 32: raise ValueError('Invalid string')
            else: output.append(ch)
        raise ValueError('Unterminated string')
    def value(self, depth=0):
        if depth > 10: raise ValueError('Literal too deep')
        self.space()
        if self.pos >= self.limit: raise ValueError('Incomplete literal')
        ch = self.text[self.pos]
        if ch in ('"', "'"): return self.string()
        if ch in ('{','['):
            self.pos += 1
            closing = '}' if ch == '{' else ']'
            result = {} if ch == '{' else []
            for _ in range(4096):
                self.space()
                if self.pos >= self.limit: raise ValueError('Incomplete literal')
                if self.text[self.pos] == closing:
                    self.pos += 1
                    return result
                if ch == '{':
                    if self.text[self.pos] in ('"', "'"): key = self.string()
                    else:
                        match = _IDENT.match(self.text,self.pos,self.limit)
                        if not match: raise ValueError('Invalid property name')
                        key = match.group(0)
                        self.pos = match.end()
                    self.space()
                    if self.pos >= self.limit or self.text[self.pos] != ':': raise ValueError('Expected colon')
                    self.pos += 1
                    if key in result: raise ValueError('Duplicate property')
                    result[key] = self.value(depth+1)
                else: result.append(self.value(depth+1))
                self.space()
                if self.pos < self.limit and self.text[self.pos] == ',': self.pos += 1
                elif self.pos >= self.limit or self.text[self.pos] != closing: raise ValueError('Expected separator')
            raise ValueError('Literal too large')
        for literal, value in (('true',True),('false',False),('null',None)):
            if self.text.startswith(literal,self.pos):
                self.pos += len(literal)
                return value
        match = _NUMBER.match(self.text,self.pos,self.limit)
        if match:
            self.pos = match.end()
            value = json.loads(match.group(0))
            if isinstance(value,float) and not math.isfinite(value): raise ValueError('Non-finite literal')
            return value
        raise ValueError('Executable or unsupported JS value')

def parse_operation(source, operation_name='SearchTimeline'):
    if operation_name not in ALLOWED_OPERATIONS:
        raise ValueError('Operation is not allowed for discovery')
    if not isinstance(source,str) or len(source) > 20*1024*1024:
        raise ValueError('Invalid main bundle text')
    found = {}
    target_key = re.compile(r'''(?<![\w$])["']?operationName["']?\s*:\s*["']''' + re.escape(operation_name) + r'''["']''')
    for match in target_key.finditer(source):
        # The operation descriptor is small. Try enclosing literal objects only;
        # arbitrary module wrappers/functions are rejected by the literal parser.
        end = match.start()
        for _ in range(32):
            start = source.rfind('{',max(0,match.start()-65536),end)
            if start < 0: break
            end = start
            try:
                parser = _Literal(source,start)
                obj = parser.value()
            except ValueError: continue
            if parser.pos <= match.start() or not isinstance(obj,dict): continue
            if obj.get('operationName') != operation_name: continue
            query_id = obj.get('queryId')
            metadata = obj.get('metadata')
            features = metadata.get('featureSwitches') if isinstance(metadata,dict) else None
            if not isinstance(query_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{6,100}',query_id):
                raise ValueError('Malformed operation query ID')
            if not isinstance(features,list) or len(features)>200 or any(not isinstance(f,str) or not re.fullmatch(r'[A-Za-z0-9_]{1,200}',f) for f in features):
                raise ValueError('Malformed operation feature switches')
            key = (query_id,tuple(features))
            found[key] = {'queryId':query_id,'operationName':operation_name,'url':f'https://x.com/i/api/graphql/{query_id}/{operation_name}','features':features}
            break
    if len(found) != 1:
        raise ValueError('Current operation descriptor is missing or ambiguous')
    return next(iter(found.values()))

async def discover_operation(transaction, session, headers=None, operation_name='SearchTimeline'):
    if operation_name not in ALLOWED_OPERATIONS:
        raise ValueError('Operation is not allowed for discovery')
    page = getattr(transaction,'home_page_response',None)
    if page is None: raise ValueError('Authenticated transaction is not initialized')
    source_url = main_bundle_url(page)
    safe_headers = {key:value for key,value in (headers or {}).items() if key.lower() not in {'cookie','authorization','x-csrf-token'}}
    response = await session.request(method='GET',url=source_url,headers=safe_headers)
    response.raise_for_status()
    result = parse_operation(response.text,operation_name)
    return {**result,'sourceUrl':source_url}
