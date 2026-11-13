// Ready-made example so anyone (including judges) can see the output without an API key.

export const SAMPLE_LECTURE = `DBMS Lecture 9: Transactions and Concurrency Control
A transaction is a sequence of reads and writes that must execute as one logical unit. ACID properties: Atomicity, Consistency, Isolation, Durability.
When transactions run concurrently, anomalies can occur: lost update, dirty read, unrepeatable read.
A schedule is serial if transactions run one after another. A schedule is conflict serializable if it can be transformed into a serial schedule by swapping non-conflicting operations. Two operations conflict if they belong to different transactions, access the same item, and at least one is a write.
Test: build a precedence graph. Add an edge Ti -> Tj if an operation of Ti conflicts with and comes before an operation of Tj. The schedule is conflict serializable iff the graph has no cycle.
Two-phase locking (2PL): a transaction acquires locks in a growing phase and releases them in a shrinking phase; once it releases a lock it cannot acquire any new lock. 2PL guarantees conflict serializability but can cause deadlocks. Strict 2PL holds exclusive locks until commit, preventing cascading aborts.`;

export const SAMPLE_NOTES = {
  title: 'Transactions and Concurrency Control',
  summary: 'How a database runs many transactions at once without corrupting data.',
  sections: [
    {
      heading: 'Transaction and ACID',
      idea: 'A transaction is a group of reads and writes that succeeds or fails as one unit.',
      example: {
        setup: 'Transfer ₹500 from account A (₹1000) to B (₹200).',
        steps: ['Read A = 1000', 'Write A = 500', 'Read B = 200', 'Write B = 700', 'Commit: total stays ₹1200'],
      },
      table: {
        caption: 'ACID with the transfer example',
        columns: ['Property', 'Means', 'In the example'],
        rows: [
          ['Atomicity', 'All or nothing', 'Crash after Write A? Undo it'],
          ['Consistency', 'Rules stay true', 'A + B is still 1200'],
          ['Isolation', 'No peeking mid-way', 'Others never see A=500, B=200'],
          ['Durability', 'Committed = saved', 'Survives a power cut'],
        ],
      },
      diagram: null,
      remember: ['ACID = All, Correct, Isolated, Durable', 'Atomicity uses the undo log, durability uses the redo log'],
    },
    {
      heading: 'Lost update anomaly',
      idea: 'Two transactions overwrite each other because they read the same old value.',
      example: {
        setup: 'Stock X = 10. T1 sells 2, T2 sells 3. Correct answer: 5.',
        steps: ['Both read 10', 'T1 writes 8', 'T2 writes 7', 'Final X = 7: T1\'s sale is lost'],
      },
      table: {
        caption: 'Timeline of reads and writes',
        columns: ['Time', 'T1', 'T2', 'X in DB'],
        rows: [
          ['t1', 'Read X = 10', '', '10'],
          ['t2', '', 'Read X = 10', '10'],
          ['t3', 'Write X = 8', '', '8'],
          ['t4', '', 'Write X = 7', '7 ❌ should be 5'],
        ],
      },
      diagram: null,
      remember: ['Lost update = write-write conflict on a stale read', 'Other anomalies: dirty read, unrepeatable read'],
    },
    {
      heading: 'Conflicting operations',
      idea: 'Two operations conflict if different transactions touch the same item and at least one writes.',
      example: {
        setup: 'Check pairs on item X.',
        steps: ['R1(X), R2(X): no conflict', 'R1(X), W2(X): conflict', 'W1(X), W2(X): conflict', 'W1(X), R2(Y): no, different items'],
      },
      table: {
        caption: 'Conflict table',
        columns: ['', 'Read', 'Write'],
        rows: [
          ['Read', '✅ no conflict', '❌ conflict'],
          ['Write', '❌ conflict', '❌ conflict'],
        ],
      },
      diagram: null,
      remember: ['Only Read-Read is safe', 'Same transaction never conflicts with itself'],
    },
    {
      heading: 'Precedence graph test',
      idea: 'Draw an edge Ti to Tj when Ti does a conflicting operation first. No cycle means conflict serializable.',
      example: {
        setup: 'Schedule S: R1(A) W2(A) R2(B) W1(B)',
        steps: ['R1(A) before W2(A): edge T1 → T2', 'R2(B) before W1(B): edge T2 → T1', 'T1 → T2 → T1 is a cycle', 'So S is NOT conflict serializable'],
      },
      table: null,
      diagram: {
        caption: 'Precedence graph for S has a cycle',
        mermaid: 'flowchart LR\n  T1["T1"] -- "A: R1 before W2" --> T2["T2"]\n  T2 -- "B: R2 before W1" --> T1',
      },
      remember: ['Cycle = not serializable', 'No cycle: a topological order gives the equivalent serial schedule'],
    },
    {
      heading: 'Two-phase locking (2PL)',
      idea: 'Take all locks first (growing), then only release (shrinking). Never lock again after the first unlock.',
      example: {
        setup: 'T1 needs A and B.',
        steps: ['Lock A', 'Lock B (lock point)', 'Read and write A, B', 'Unlock A', 'Unlock B, and now it cannot lock anything new'],
      },
      table: {
        caption: 'Basic 2PL vs Strict 2PL',
        columns: ['', 'Basic 2PL', 'Strict 2PL'],
        rows: [
          ['Release X-locks', 'Any time in shrinking phase', 'Only at commit'],
          ['Serializable?', 'Yes', 'Yes'],
          ['Cascading aborts?', 'Possible', 'Prevented'],
          ['Deadlocks?', 'Possible', 'Possible'],
        ],
      },
      diagram: {
        caption: 'The two phases',
        mermaid: 'flowchart LR\n  S["Start"] --> G["Growing: acquire locks"]\n  G --> P["Lock point"]\n  P --> H["Shrinking: release locks"]\n  H --> C["Commit"]',
      },
      remember: ['2PL guarantees conflict serializability', '2PL does NOT prevent deadlock: exam trap'],
      doubts: [
        {
          q: 'If 2PL is so safe, why can it still deadlock?',
          answer: '2PL only controls WHEN locks are released, not the ORDER they are requested. Two transactions can each hold one lock and wait for the other forever.',
          example: {
            setup: 'T1 and T2 both follow 2PL and both need A and B.',
            steps: ['T1 locks A, T2 locks B (both growing)', 'T1 asks for B: waits', 'T2 asks for A: waits', 'Nobody unlocks, so both are stuck'],
          },
        },
      ],
    },
    {
      heading: 'Deadlock under 2PL',
      idea: 'Each transaction waits for a lock the other holds, so neither can continue.',
      example: {
        setup: 'T1 locks A, T2 locks B.',
        steps: ['T1 requests B: waits for T2', 'T2 requests A: waits for T1', 'Wait-for graph has a cycle: deadlock', 'DBMS aborts one transaction (victim)'],
      },
      table: null,
      diagram: {
        caption: 'Who waits for whom',
        mermaid: 'sequenceDiagram\n  participant T1\n  participant T2\n  T1->>T1: lock A\n  T2->>T2: lock B\n  T1->>T2: wants B, waits\n  T2->>T1: wants A, waits\n  Note over T1,T2: cycle means deadlock',
      },
      remember: ['Fix: detect cycle and abort a victim, or use timeouts / wait-die'],
    },
  ],
  keyTerms: [
    { term: 'Transaction', meaning: 'Reads and writes that act as one unit' },
    { term: 'Schedule', meaning: 'Order in which operations of transactions run' },
    { term: 'Serial schedule', meaning: 'Transactions run one after another, no overlap' },
    { term: 'Conflict', meaning: 'Different transactions, same item, at least one write' },
    { term: 'Conflict serializable', meaning: 'Can be reordered into a serial schedule by swapping non-conflicts' },
    { term: 'Precedence graph', meaning: 'Graph of conflict order; cycle means not serializable' },
    { term: '2PL', meaning: 'Growing then shrinking lock phases' },
    { term: 'Cascading abort', meaning: 'One abort forces others that read its data to abort' },
  ],
  quiz: [
    { q: 'Which pair of operations does NOT conflict?', options: ['R1(X), W2(X)', 'W1(X), W2(X)', 'R1(X), R2(X)', 'W1(X), R2(X)'], answer: 2, why: 'Two reads never conflict.' },
    { q: 'A precedence graph has a cycle. The schedule is…', options: ['Serial', 'Conflict serializable', 'Not conflict serializable', 'Deadlocked'], answer: 2, why: 'Cycle means no equivalent serial order.' },
    { q: 'What does 2PL NOT prevent?', options: ['Lost updates', 'Deadlocks', 'Non-serializable schedules', 'Dirty writes'], answer: 1, why: '2PL can still deadlock.' },
    { q: 'Strict 2PL holds exclusive locks until…', options: ['The lock point', 'Commit or abort', 'The next read', 'The growing phase ends'], answer: 1, why: 'That is what prevents cascading aborts.' },
    { q: 'Stock = 10; T1 sells 2, T2 sells 3, both read 10 first. Final value with lost update?', options: ['5', '8 or 7', '10', '0'], answer: 1, why: 'The last writer wins: 8 or 7, never 5.' },
  ],
};
