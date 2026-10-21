package s3x

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestHint(t *testing.T) {
	cases := map[string]string{
		"operation error S3: ListObjectsV2, api error SignatureDoesNotMatch: UnknownError": "secret key is wrong",
		"api error InvalidAccessKeyId":                        "does not exist on the endpoint",
		"api error RequestTimeTooSkewed":                      "clock differs",
		"api error AccessDenied":                              "not allowed",
		"api error BucketNotEmpty":                            "not empty",
		"api error NoSuchBucket":                              "no such bucket",
		"x509: certificate signed by unknown authority":       "TLS certificate",
		"dial tcp 10.0.0.1:9000: connect: connection refused": "cannot reach the endpoint",
		"api error NoSuchKey":                                 "",
	}
	for msg, want := range cases {
		got := Hint(fmt.Errorf("%s", msg))
		if want == "" {
			if got != "" {
				t.Errorf("Hint(%q) = %q, want empty", msg, got)
			}
			continue
		}
		if got == "" || !strings.Contains(got, want) {
			t.Errorf("Hint(%q) = %q, want it to mention %q", msg, got, want)
		}
	}
	if Hint(nil) != "" {
		t.Error("Hint(nil) should be empty")
	}
	if Hint(errors.New("random")) != "" {
		t.Error("unrelated error should have no hint")
	}
}
