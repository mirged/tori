# Quiz JSON, version 1

A UTF-8 `.json` file contains one quiz. No server or account identifiers are
required. Extra object properties are discarded on validated import.

```json
{
  "version": 1,
  "id": "my-quiz",
  "title": "A curious little quiz",
  "description": "For a room full of good company.",
  "category": "General knowledge",
  "cover": "green",
  "questions": [
    {
      "id": "question-1",
      "type": "multiple",
      "text": "Which animals are mammals?",
      "options": ["Dolphin", "Penguin", "Bat", "Octopus"],
      "correct": [0, 2],
      "seconds": 25,
      "explanation": "Dolphins and bats nurse their young."
    }
  ]
}
```

`correct` contains **zero-based indexes**, with no duplicates. Question IDs must
be unique within a quiz. Imported quiz IDs are replaced to keep browser drafts
separate. Cover choices: `green`, `peach`, `lilac`, `blue`.

Types are `single` (exactly one correct option), `boolean` (options must be
`["True", "False"]`, exactly one correct option), and `multiple` (one or more
correct options). A hosted quiz requires 1–50 questions, 2–6 nonempty options per
question, time limits of 5–240 whole seconds, a nonempty title (up to 100
characters), question text up to 300, option text up to 160, descriptions up to
300, and explanations up to 1,000. IDs are at most 80 characters; category at most
40. Draft import/export also permits empty fields, no correct answers, and no
questions so an unfinished quiz can move between browsers. Hosts always validate
against the stricter playable schema.

Optional question `image` is an inline PNG/JPEG/WebP data URL, no external URL or
SVG. It must have a matching binary header and at most 1,000,000 decoded bytes.
The editor checks MIME type, size, and header; import and hosting revalidate.
Image content is rendered using an `<img>` element and never executable HTML.
The complete JSON upload is limited to 8 MB. Plain text is rendered by React.

CSV exports use UTF-8 with BOM, quoted fields, and CRLF rows. Columns are nickname,
total score, and one points column per question (named with its question text).
Spreadsheet formula prefixes are neutralized. Only the authenticated host can
export, and only after the game finishes.
