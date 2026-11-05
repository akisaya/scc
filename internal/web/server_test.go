package web

import (
	"bytes"
	"testing"
)

func TestRenderIndexEscapesVersion(t *testing.T) {
	const version = `v1.2.3"><script>alert(1)</script>`
	page, err := renderIndex(version)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(page, []byte(version)) {
		t.Fatal("version was inserted without escaping")
	}
	if bytes.Contains(page, []byte(versionPlaceholder)) {
		t.Fatal("version placeholder was not replaced")
	}
	const escaped = `v1.2.3&#34;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`
	if !bytes.Contains(page, []byte("<title>scc "+escaped+"</title>")) {
		t.Fatal("title does not contain the escaped version")
	}
	if !bytes.Contains(page, []byte(">"+escaped+"</span>")) {
		t.Fatal("brand does not contain the escaped version")
	}
}
