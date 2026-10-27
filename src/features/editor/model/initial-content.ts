// Authored seed: schema 1 and one stable, empty paragraph shared by simultaneous first opens.
// This is generated Bloco content, not an external asset or an authentication credential.
const seed =
  "AQX0qN+cDQAoAQRtZXRhDXNjaGVtYVZlcnNpb24BfQEoAQppZGVudGl0aWVzB2luaXRpYWwBeCgBBmJsb2Nrcwdpbml0aWFsAXcJcGFyYWdyYXBoKAEKcGxhY2VtZW50cwdpbml0aWFsAXYCCHBhcmVudElkfghwb3NpdGlvbncBbQcBFWJsb2NrLWNvbnRlbnQ6aW5pdGlhbAMJcGFyYWdyYXBoAA==";
export function initialContentUpdate(): Uint8Array {
  return Uint8Array.from(atob(seed), (character) => character.charCodeAt(0));
}
