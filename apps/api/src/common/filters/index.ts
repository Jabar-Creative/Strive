// Barrel exception filter. Bentuk error dikunci di docs/PRD.md §10.1:
//   { error: { code, message, details } }
// `code` adalah KONTRAK, `message` bukan. Client tidak pernah parsing message.
export {};
