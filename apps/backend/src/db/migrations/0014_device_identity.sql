-- 0014_device_identity: cryptographic proof-of-possession for devices.
-- Adds a public_key column so the server can verify the device controls a
-- keypair, not just that it knows a device_id string.

ALTER TABLE devices ADD COLUMN public_key TEXT;
