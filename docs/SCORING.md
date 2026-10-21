# Tori scoring, version 1

These rules are part of the quiz protocol and shown before a game starts.

Accuracy is the default. A fully correct answer earns 1,000 points, regardless
of speed. Single-choice and true/false questions earn either 0 or 1,000.

For multiple-answer questions, credit is `max(0, C/K - W/I)`, where C is the
number of selected correct options, K is the total number of correct options,
W is the number of selected incorrect options, and I is the total number of
incorrect options. If I is zero, the wrong-option term is zero. An unanswered
question earns zero. This awards partial knowledge without rewarding selecting
every option. Points are rounded once, to the nearest integer.

Optional speed scoring multiplies that credit by
`1000 × (1 - 0.5 × min(1, elapsed / duration))`, then rounds once. A fully
correct answer earns between 500 and 1,000 points. Elapsed time is measured
by the server, excluding pauses. Network latency affects this mode.

The server accepts one final answer per player per question. An empty selection
is invalid; an unanswered question simply expires. The answer must arrive
strictly before the server deadline. Acknowledgements follow durable storage.
Repeating an accepted request ID returns the original acceptance without
awarding points again. Other second submissions are rejected.

Ties share a rank; tied names sort alphabetically for display. The cooperative
class percentage is total earned accuracy credit divided by the possible
accuracy points for all approved, non-removed players over completed questions.
It does not include a speed bonus or penalize the class for choosing speed mode.

State transitions: lobby → question → reveal → standings → question (or
finished). Only authenticated hosts can advance, close early, pause, resume,
moderate, lock, or delete. Correct options and explanations stay on the server
until reveal. Only finished rooms expose the complete review to players.
