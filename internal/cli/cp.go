package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/akisaya/scc/internal/s3x"
)

func cpCmd(args []string) error {
	fs := flag.NewFlagSet("cp", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "copy recursively")
	prefixMode := fs.Bool("p", false, "treat the S3 source as a raw prefix")
	skipExisting := fs.Bool("skip-existing", false, "keep existing destination files or objects")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() != 2 {
		return errors.New("usage: scc cp [-p] [-r] [--skip-existing] <src> <dst>")
	}
	src, dst := fs.Arg(0), fs.Arg(1)
	if *prefixMode && !isS3(src) {
		return errors.New("cp -p requires an S3 source")
	}
	switch {
	case isS3(src) && isS3(dst):
		return cpS3ToS3(src, dst, *recursive, *prefixMode, *skipExisting)
	case isS3(src):
		return cpS3ToLocal(src, dst, *recursive, *prefixMode, *skipExisting)
	case isS3(dst):
		return cpLocalToS3(src, dst, *recursive, *skipExisting)
	default:
		return errors.New("one side must be <account>://bucket/key")
	}
}

func cpS3ToLocal(src, dst string, recursive, prefixMode, skipExisting bool) error {
	c, t, err := withTarget(src)
	if err != nil {
		return err
	}
	if t.key == "" {
		return errors.New("source needs a key or a prefix")
	}
	ctx := ctx()
	// HEAD shares the permission used by GET, so copying a file needs no listing access.
	selected, err := resolveSource(t.key, prefixMode, func() (s3x.Object, error) {
		return copyObject(ctx, c, t.bucket, t.key)
	})
	if err != nil {
		return err
	}

	if selected.object != nil {
		target := dst
		if fi, err := os.Stat(dst); (err == nil && fi.IsDir()) || strings.HasSuffix(dst, string(os.PathSeparator)) {
			target = filepath.Join(dst, path.Base(t.key))
		}
		progress := newTransfer("downloaded", 1)
		defer progress.finish()
		return download(ctx, c, t.bucket, *selected.object, target, skipExisting, progress)
	}
	if !prefixMode && !recursive {
		if _, err := listSource(ctx, c, t.bucket, src, selected, false, false, 1); err != nil {
			return err
		}
		return fmt.Errorf("source %q is not a file; pass -r to download directory contents", src)
	}

	l, err := listSource(ctx, c, t.bucket, src, selected, recursive, prefixMode, 0)
	if err != nil {
		return err
	}
	base := selected.prefix
	if prefixMode {
		base = parentPrefix(base)
	}
	targets, err := downloadTargets(l.Objects, base, dst)
	if err != nil {
		return err
	}
	progress := newTransfer("downloaded", len(targets))
	defer progress.finish()
	if len(targets) == 0 && prefixMode {
		noMatchingFiles(src, l)
	}
	for _, o := range l.Objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		if err := download(ctx, c, t.bucket, o, targets[o.Key], skipExisting, progress); err != nil {
			return err
		}
	}
	return nil
}

// Check the complete mapping before downloading: S3 keys can collide when
// represented as local paths, especially a file and a same-named directory.
func downloadTargets(objects []s3x.Object, base, dst string) (map[string]string, error) {
	targets := make(map[string]string)
	keys := make(map[string]string)
	for _, o := range objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		rel := filepath.FromSlash(strings.TrimPrefix(o.Key, base))
		if !filepath.IsLocal(rel) || filepath.Clean(rel) == "." {
			return nil, fmt.Errorf("object %q cannot be mapped inside destination %q", o.Key, dst)
		}
		target := filepath.Join(dst, rel)
		if other, ok := keys[target]; ok {
			return nil, fmt.Errorf("objects %q and %q map to the same local path", other, o.Key)
		}
		targets[o.Key], keys[target] = target, o.Key
	}
	for _, o := range objects {
		target, ok := targets[o.Key]
		if !ok {
			continue
		}
		for dir := filepath.Dir(target); ; dir = filepath.Dir(dir) {
			if other, ok := keys[dir]; ok {
				return nil, fmt.Errorf("local file/directory conflict between objects %q and %q", other, o.Key)
			}
			if dir == filepath.Dir(dir) {
				break
			}
		}
	}
	return targets, nil
}

func download(ctx context.Context, c *s3x.Client, bucket string, object s3x.Object, dst string, skipExisting bool, progress *transfer) error {
	if skipExisting {
		exists, err := localFileExists(dst)
		if err != nil {
			return err
		}
		if exists {
			progress.skip(dst)
			return nil
		}
	}
	progress.begin(object.Key, object.Size)
	out, err := c.Get(ctx, bucket, object.Key)
	if err != nil {
		return err
	}
	defer out.Body.Close()
	expected := out.ContentLength
	if expected == nil || *expected < 0 {
		// Chunked responses still have the length obtained from HEAD or listing.
		expected = &object.Size
	}
	n, err := saveDownload(dst, out.Body, expected, progress)
	if err != nil {
		return err
	}
	progress.success(object.Key, dst, n)
	return nil
}

func cpLocalToS3(src, dst string, recursive, skipExisting bool) error {
	c, t, err := withTarget(dst)
	if err != nil {
		return err
	}
	if t.bucket == "" {
		return errors.New("destination needs a bucket")
	}
	ctx := ctx()

	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		key := t.key
		if key == "" || strings.HasSuffix(key, "/") {
			key = joinKey(key, filepath.Base(src))
		}
		progress := newTransfer("uploaded", 1)
		defer progress.finish()
		return upload(ctx, c, t.bucket, key, src, fi.Size(), skipExisting, progress)
	}
	if !recursive {
		return fmt.Errorf("%s is a directory, pass -r", src)
	}
	type job struct {
		path, key string
		size      int64
	}
	var jobs []job
	err = filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		key := joinKey(t.key, filepath.ToSlash(rel))
		info, err := d.Info()
		if err != nil {
			return err
		}
		jobs = append(jobs, job{p, key, info.Size()})
		return nil
	})
	if err != nil {
		return err
	}
	progress := newTransfer("uploaded", len(jobs))
	defer progress.finish()
	for _, job := range jobs {
		if err := upload(ctx, c, t.bucket, job.key, job.path, job.size, skipExisting, progress); err != nil {
			return err
		}
	}
	return nil
}

func upload(ctx context.Context, c *s3x.Client, bucket, key, src string, size int64, skipExisting bool, progress *transfer) error {
	if skipExisting {
		exists, err := remoteFileExists(ctx, c, bucket, key)
		if err != nil {
			return err
		}
		if exists {
			progress.skip(key)
			return nil
		}
	}
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	progress.begin(key, size)
	ct := mime.TypeByExtension(filepath.Ext(src))
	if err := c.Put(ctx, bucket, key, &progressSeeker{f, progress}, size, ct); err != nil {
		return err
	}
	progress.success(src, key, size)
	return nil
}

func cpS3ToS3(src, dst string, recursive, prefixMode, skipExisting bool) error {
	sc, st, err := withTarget(src)
	if err != nil {
		return err
	}
	dc, dt, err := withTarget(dst)
	if err != nil {
		return err
	}
	if st.key == "" || dt.bucket == "" {
		return errors.New("source and destination both need a key")
	}
	if st.acct != dt.acct {
		return errors.New("cross-account copy is not supported; download and upload instead")
	}
	ctx := ctx()
	selected, err := resolveSource(st.key, prefixMode, func() (s3x.Object, error) {
		return copyObject(ctx, sc, st.bucket, st.key)
	})
	if err != nil {
		return err
	}

	if selected.object != nil {
		key := dt.key
		if key == "" || strings.HasSuffix(key, "/") {
			key = joinKey(key, path.Base(st.key))
		}
		progress := newTransfer("copied", 1)
		defer progress.finish()
		return copyRemote(ctx, dc, st, dt, *selected.object, key, skipExisting, progress)
	}
	if !prefixMode && !recursive {
		if _, err := listSource(ctx, sc, st.bucket, src, selected, false, false, 1); err != nil {
			return err
		}
		return fmt.Errorf("source %q is not a file; pass -r to copy directory contents", src)
	}

	l, err := listSource(ctx, sc, st.bucket, src, selected, recursive, prefixMode, 0)
	if err != nil {
		return err
	}
	base := selected.prefix
	if prefixMode {
		base = parentPrefix(base)
	}
	total := 0
	for _, o := range l.Objects {
		if !strings.HasSuffix(o.Key, "/") {
			total++
		}
	}
	progress := newTransfer("copied", total)
	defer progress.finish()
	if total == 0 && prefixMode {
		noMatchingFiles(src, l)
	}
	for _, o := range l.Objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		rel := strings.TrimPrefix(o.Key, base)
		key := joinKey(dt.key, rel)
		if err := copyRemote(ctx, dc, st, dt, o, key, skipExisting, progress); err != nil {
			return err
		}
	}
	return nil
}

func remoteFileExists(ctx context.Context, c *s3x.Client, bucket, key string) (bool, error) {
	object, err := copyObject(ctx, c, bucket, key)
	if s3x.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return object.Key == key, nil
}

func copyRemote(ctx context.Context, dc *s3x.Client, src, dst target, object s3x.Object, key string, skipExisting bool, progress *transfer) error {
	if skipExisting {
		exists, err := remoteFileExists(ctx, dc, dst.bucket, key)
		if err != nil {
			return err
		}
		if exists {
			progress.skip(key)
			return nil
		}
	}
	progress.beginCopy(object.Key, object.Size)
	if err := dc.Copy(ctx, dst.bucket, key, s3x.Ref{Account: src.acct, Bucket: src.bucket, Key: object.Key}); err != nil {
		return err
	}
	progress.success(src.acct+"://"+src.bucket+"/"+object.Key, dst.acct+"://"+dst.bucket+"/"+key, object.Size)
	return nil
}

func joinKey(a, b string) string {
	a = strings.TrimSuffix(a, "/")
	b = strings.TrimPrefix(b, "/")
	if a == "" {
		return b
	}
	return a + "/" + b
}
