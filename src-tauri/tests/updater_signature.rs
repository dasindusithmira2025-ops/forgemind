use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

fn assert_signature_accepts_payload_and_rejects_tampering(
    public_key: &str,
    signature: &str,
    payload: &[u8],
) {
    let public_key = PublicKey::decode(public_key).unwrap();
    let signature = Signature::decode(signature).unwrap();

    public_key.verify(payload, &signature, false).unwrap();

    let mut tampered = payload.to_vec();
    tampered[0] ^= 0x01;
    assert!(public_key.verify(&tampered, &signature, false).is_err());
}

#[test]
fn signed_updater_payload_is_accepted_and_tampering_is_rejected() {
    assert_signature_accepts_payload_and_rejects_tampering(
        include_str!("fixtures/updater-test.pub"),
        include_str!("fixtures/updater-payload.txt.sig"),
        include_bytes!("fixtures/updater-payload.txt"),
    );
}

#[test]
fn stable_release_key_accepts_its_fixture_and_rejects_tampering() {
    let public_key = String::from_utf8(
        STANDARD
            .decode(include_str!("../../release/updater.stable.pubkey").trim())
            .unwrap(),
    )
    .unwrap();
    let signature = String::from_utf8(
        STANDARD
            .decode(include_str!("fixtures/updater-stable-payload.txt.sig").trim())
            .unwrap(),
    )
    .unwrap();
    assert_signature_accepts_payload_and_rejects_tampering(
        &public_key,
        &signature,
        include_bytes!("fixtures/updater-stable-payload.txt"),
    );
}
