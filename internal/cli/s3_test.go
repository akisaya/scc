package cli

import (
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/akisaya/scc/internal/config"
)

type listRequest struct{ prefix, delimiter string }

type s3Mock struct {
	mu              sync.Mutex
	objects         map[string]string
	requests        []listRequest
	denyList        bool
	denyHead        bool
	gets            []string
	writes          []string
	deletes         [][]string
	shortGet        string
	shortChunkedGet string
	deleteFailure   string
}

func newS3Mock(t *testing.T, keys []string, denied bool) *s3Mock {
	t.Helper()
	m := &s3Mock{objects: make(map[string]string)}
	for _, key := range keys {
		m.objects[key] = "payload"
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if denied || (m.denyList && r.URL.Query().Get("list-type") == "2") || (m.denyHead && r.Method == http.MethodHead) {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, "<Error><Code>AccessDenied</Code><Message>denied</Message></Error>")
			return
		}
		q := r.URL.Query()
		if r.Method == http.MethodPost && r.URL.Path == "/b" && q.Has("delete") {
			var request struct {
				Objects []struct{ Key string } `xml:"Object"`
			}
			if err := xml.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			var batch []string
			response := struct {
				XMLName xml.Name                     `xml:"DeleteResult"`
				Errors  []struct{ Key, Code string } `xml:"Error"`
			}{}
			for _, object := range request.Objects {
				batch = append(batch, object.Key)
				if object.Key == m.deleteFailure {
					response.Errors = append(response.Errors, struct{ Key, Code string }{object.Key, "AccessDenied"})
				} else {
					delete(m.objects, object.Key)
				}
			}
			m.deletes = append(m.deletes, batch)
			w.Header().Set("Content-Type", "application/xml")
			xml.NewEncoder(w).Encode(response)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/b" && q.Get("list-type") == "2" {
			m.requests = append(m.requests, listRequest{q.Get("prefix"), q.Get("delimiter")})
			// Model S3's ordered prefix listing, delimiter grouping and page cap.
			type object struct {
				Key          string
				Size         int
				LastModified string
			}
			type commonPrefix struct{ Prefix string }
			page := struct {
				XMLName               xml.Name `xml:"ListBucketResult"`
				IsTruncated           bool
				NextContinuationToken string         `xml:",omitempty"`
				Contents              []object       `xml:"Contents"`
				CommonPrefixes        []commonPrefix `xml:"CommonPrefixes"`
			}{}
			entries := map[string]bool{}
			for key := range m.objects {
				if !strings.HasPrefix(key, q.Get("prefix")) {
					continue
				}
				if q.Get("delimiter") == "/" {
					rest := strings.TrimPrefix(key, q.Get("prefix"))
					if i := strings.IndexByte(rest, '/'); i >= 0 {
						entries[q.Get("prefix")+rest[:i+1]] = true
						continue
					}
				}
				entries[key] = false
			}
			var names []string
			for key := range entries {
				names = append(names, key)
			}
			sort.Strings(names)
			if max, _ := strconv.Atoi(q.Get("max-keys")); max > 0 && len(names) > max {
				page.IsTruncated = true
				page.NextContinuationToken = "next"
				names = names[:max]
			}
			for _, key := range names {
				if entries[key] {
					page.CommonPrefixes = append(page.CommonPrefixes, commonPrefix{key})
				} else {
					page.Contents = append(page.Contents, object{key, len(m.objects[key]), "2026-01-01T00:00:00Z"})
				}
			}
			w.Header().Set("Content-Type", "application/xml")
			if err := xml.NewEncoder(w).Encode(page); err != nil {
				t.Error(err)
			}
			return
		}
		if key, ok := strings.CutPrefix(r.URL.Path, "/b/"); ok {
			switch r.Method {
			case http.MethodHead:
				if body, ok := m.objects[key]; ok {
					w.Header().Set("Content-Length", strconv.Itoa(len(body)))
					w.Header().Set("Last-Modified", "Thu, 01 Jan 2026 00:00:00 GMT")
					return
				}
				w.WriteHeader(http.StatusNotFound)
				return
			case http.MethodGet:
				if body, ok := m.objects[key]; ok {
					m.gets = append(m.gets, key)
					if key == m.shortChunkedGet {
						w.WriteHeader(http.StatusOK)
						w.(http.Flusher).Flush()
						fmt.Fprint(w, body[:3])
						return
					}
					if key == m.shortGet {
						w.Header().Set("Content-Length", strconv.Itoa(len(body)+10))
					}
					fmt.Fprint(w, body)
					return
				}
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, "<Error><Code>NoSuchKey</Code></Error>")
				return
			case http.MethodPut:
				m.writes = append(m.writes, key)
				if r.Header.Get("X-Amz-Copy-Source") == "" {
					body, err := io.ReadAll(r.Body)
					if err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					m.objects[key] = string(body)
					w.Header().Set("ETag", `"e"`)
					return
				}
				src, err := url.PathUnescape(r.Header.Get("X-Amz-Copy-Source"))
				if err == nil {
					if body, ok := m.objects[strings.TrimPrefix(src, "b/")]; ok {
						m.objects[key] = body
						w.Header().Set("Content-Type", "application/xml")
						fmt.Fprint(w, `<CopyObjectResult><ETag>"e"</ETag><LastModified>2026-01-01T00:00:00Z</LastModified></CopyObjectResult>`)
						return
					}
				}
			}
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("SCC_CONFIG", filepath.Join(t.TempDir(), "config.yaml"))
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg.Upsert(config.Account{Name: "local", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", PathStyle: true, DefaultBucket: "b"})
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	return m
}

func runCLI(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	stdout, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer stdout.Close()
	stderr, err := os.CreateTemp(t.TempDir(), "stderr")
	if err != nil {
		t.Fatal(err)
	}
	defer stderr.Close()
	oldOut, oldErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = stdout, stderr
	defer func() { os.Stdout, os.Stderr = oldOut, oldErr }()
	runErr := Run(args, "test")
	out, err := os.ReadFile(stdout.Name())
	if err != nil {
		t.Fatal(err)
	}
	errOut, err := os.ReadFile(stderr.Name())
	if err != nil {
		t.Fatal(err)
	}
	return string(out), string(errOut), runErr
}
