// Environment the Lambda reads at load time. Fake values only: tests never
// reach AWS, Expo or a push service.
process.env.TABLE_NAME = "test-table";
process.env.GSI_NAME = "byType";
process.env.API_KEY = "test-key";
process.env.RELEASE_BUCKET = "test-releases";
process.env.MEDIA_BUCKET = "test-media";
process.env.AWS_REGION = "us-west-2";
process.env.AWS_ACCESS_KEY_ID = "AKIDEXAMPLE";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
delete process.env.AWS_SESSION_TOKEN;
