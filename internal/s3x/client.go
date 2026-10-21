package s3x

import (
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"scc/internal/config"
)

type Client struct {
	*s3.Client
	Acct config.Account
}

func Open(a config.Account) (*Client, error) {
	if a.AccessKey == "" || a.SecretKey == "" {
		return nil, fmt.Errorf("account %q: access_key/secret_key is empty", a.Name)
	}
	region := a.Region
	if region == "" {
		region = "us-east-1"
	}
	opts := s3.Options{
		Region:       region,
		Credentials:  credentials.NewStaticCredentialsProvider(a.AccessKey, a.SecretKey, ""),
		UsePathStyle: a.PathStyle,
		// R2/B2 reject the new default flexible checksums on some operations.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	}
	if a.Endpoint != "" {
		opts.BaseEndpoint = aws.String(a.Endpoint)
	}
	return &Client{Client: s3.New(opts), Acct: a}, nil
}

// Ref is a fully qualified object location.
type Ref struct {
	Account string
	Bucket  string
	Key     string
}
