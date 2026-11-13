# Demo Fix -> Verify Loop

Use this safe sandbox item to test Settled's full remediation loop without touching real system settings:

1. Run **check** — it fails if the temporary flag file does not exist yet.
2. Click **fix** — confirms execution, creates a harmless flag file in your OS temp folder, and automatically re-runs **check** so the traffic light flips green.
3. Run **reset-demo** anytime to remove the temp flag and repeat the test.
