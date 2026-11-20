package cli

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Save in the destination directory so replacement happens only after a complete
// transfer, with no cross-filesystem rename and no truncated final file.
func saveDownload(dst string, body io.Reader, expected *int64, progress io.Writer) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, err
	}
	mode := os.FileMode(0o600)
	if fi, err := os.Lstat(dst); err == nil {
		if fi.IsDir() {
			return 0, fmt.Errorf("destination %q is a directory", dst)
		}
		if fi.Mode().IsRegular() {
			mode = fi.Mode().Perm()
		}
	} else if !os.IsNotExist(err) {
		return 0, err
	}
	f, err := os.CreateTemp(filepath.Dir(dst), ".scc-download-*.part")
	if err != nil {
		return 0, err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err := f.Chmod(mode); err != nil {
		return 0, err
	}
	n, err := io.Copy(io.MultiWriter(f, progress), body)
	if err != nil {
		return n, err
	}
	if expected != nil && n != *expected {
		return n, fmt.Errorf("incomplete download: got %d bytes, expected %d", n, *expected)
	}
	if err := f.Sync(); err != nil {
		return n, err
	}
	if err := f.Close(); err != nil {
		return n, err
	}
	if err := os.Rename(f.Name(), dst); err != nil {
		return n, err
	}
	return n, nil
}

func localFileExists(dst string) (bool, error) {
	fi, err := os.Lstat(dst)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if fi.IsDir() {
		return false, fmt.Errorf("destination %q is a directory", dst)
	}
	return true, nil
}
