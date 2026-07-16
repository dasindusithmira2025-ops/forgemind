use minisign_verify::{PublicKey, Signature};

#[test]
fn signed_updater_payload_is_accepted_and_tampering_is_rejected() {
    let public_key = PublicKey::decode(include_str!("fixtures/updater-test.pub")).unwrap();
    let signature = Signature::decode(include_str!("fixtures/updater-payload.txt.sig")).unwrap();
    let payload = include_bytes!("fixtures/updater-payload.txt");

    public_key.verify(payload, &signature, false).unwrap();

    let mut tampered = payload.to_vec();
    tampered[0] ^= 0x01;
    assert!(public_key.verify(&tampered, &signature, false).is_err());
}
