package cli

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

type transfer struct {
	mu                        sync.Mutex
	action                    string
	total, completed, skipped int
	bytes, current, size      int64
	label                     string
	started, updated          time.Time
	interactive               bool
	streaming                 bool
}

func newTransfer(action string, total int) *transfer {
	return &transfer{action: action, total: total, interactive: isTerminal(os.Stdout) && isTerminal(os.Stderr)}
}

func (t *transfer) begin(label string, size int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.label, t.size, t.current = label, size, 0
	t.streaming = true
	t.started, t.updated = time.Now(), time.Time{}
	t.render()
}

func (t *transfer) beginCopy(label string, size int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.label, t.size, t.current, t.streaming = label, size, 0, false
	t.started, t.updated = time.Now(), time.Time{}
	t.render()
}

func (t *transfer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.current += int64(len(p))
	t.render()
	return len(p), nil
}

func (t *transfer) render() {
	if !t.interactive || t.label == "" || time.Since(t.updated) < 150*time.Millisecond {
		return
	}
	t.updated = time.Now()
	label := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return '?'
		}
		return r
	}, t.label)
	if !t.streaming {
		fmt.Fprintf(os.Stderr, "\r\033[2K%d/%d copying %s (%s)", t.completed+t.skipped+1, t.total, label, humanSize(t.size))
		return
	}
	percent := float64(0)
	if t.size > 0 {
		percent = min(100, 100*float64(t.current)/float64(t.size))
	}
	speed := int64(float64(t.current) / max(time.Since(t.started).Seconds(), 0.001))
	fmt.Fprintf(os.Stderr, "\r\033[2K%d/%d %s: %s/%s (%3.0f%%) %s/s", t.completed+t.skipped+1, t.total, label, humanSize(t.current), humanSize(t.size), percent, humanSize(speed))
}

func (t *transfer) clear() {
	if t.interactive && t.label != "" {
		fmt.Fprint(os.Stderr, "\r\033[2K")
	}
	t.label = ""
}

func (t *transfer) success(src, dst string, size int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.clear()
	t.completed++
	t.bytes += size
	fmt.Printf("%s -> %s\n", src, dst)
}

func (t *transfer) skip(dst string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.clear()
	t.skipped++
	fmt.Fprintf(os.Stderr, "skipped %s (already exists)\n", dst)
}

func (t *transfer) finish() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.clear()
	fmt.Fprintf(os.Stderr, "%s %d file(s), %s; skipped %d\n", t.action, t.completed, humanSize(t.bytes), t.skipped)
}

type progressSeeker struct {
	io.ReadSeeker
	progress *transfer
}

func (r *progressSeeker) Read(p []byte) (int, error) {
	n, err := r.ReadSeeker.Read(p)
	r.progress.Write(p[:n])
	return n, err
}

func (r *progressSeeker) Seek(offset int64, whence int) (int64, error) {
	position, err := r.ReadSeeker.Seek(offset, whence)
	if err == nil {
		r.progress.mu.Lock()
		r.progress.current = position
		r.progress.mu.Unlock()
	}
	return position, err
}
