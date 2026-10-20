// Storage-only fixture authority. Never registered with the production Runtime.
export function fixtureIdentityAuthority() {
  const issued = new WeakMap();
  return {
    issue(claims) {
      const attestation = Object.freeze({});
      issued.set(attestation, structuredClone(claims));
      return attestation;
    },
    verifyAttestation: attestation => issued.get(attestation) || null,
  };
}
