# Third-party references

## dsh-bili-whale

The Bilibili read-only adapter references the public API workflow and field meanings documented in [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale), including its video and comment commands. The reference was reviewed for the My Fish 0.5.0 upgrade.

My Fish implements its own restricted anonymous requests and host search bridge. It does not bundle or start the upstream plugin, import its account files, copy its persona, or start its scheduler. The upstream command's video transcription, media downloads, local sharing cache, favorites and public posting are not included.

Upstream copyright: Copyright (c) 2026 ALTERSSSS. Upstream license: [MIT](https://github.com/Alterssss/dsh-bili-whale/blob/main/LICENSE). See also its [NOTICE](https://github.com/Alterssss/dsh-bili-whale/blob/main/NOTICE.md) for upstream interface references.

The MIT notice is retained below for attribution:

MIT License

Copyright (c) 2026 ALTERSSSS

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
