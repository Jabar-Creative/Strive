// Barrel exception filter. Bentuk error dikunci di docs/PRD.md §10.1:
//   { error: { code, message, details } }
// `code` adalah KONTRAK, `message` bukan. Client tidak pernah parsing message.
//
// Diisi R-04 setelah audit R-03 menemukan bahwa respons 500 TIDAK mematuhi
// bentuk itu — tidak ada filter sama sekali, jadi Nest menjawab
// {"statusCode":500,"message":"Internal server error"}.
export * from './all-exceptions.filter';
