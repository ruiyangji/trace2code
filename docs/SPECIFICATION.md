# Browser Demonstration Compiler
## Engineering Specification for Coding Agents

**Working name:** Trace2Code  
**Primary goal:** Record a human browser workflow, distill the interaction trace into a semantic workflow representation, and compile that representation into deployable browser automation source code.  
**Secondary goal:** Support a semantic execution mode that can recover from UI changes using an LLM without requiring the LLM for every normal execution.

---

# 1. Product Definition

Trace2Code is a browser automation compiler.

A user performs a task manually in a browser. The system captures enough information about the interaction to infer what the user intended, removes irrelevant UI mechanics, and produces a reusable program.

Examples:

- Filling out a recurring internal form
- Downloading a report
- Searching a dashboard and extracting results
- Uploading files
- Creating an account in an internal admin tool
- Repeating a multi-step QA workflow
- Moving through an internal operations workflow

The project is **not** primarily an autonomous browser agent.

The intended execution model is:

```text
human demonstration
        |
        v
interaction trace
        |
        v
deterministic preprocessing
        |
        v
semantic workflow IR
        |
        +---------------------+
        |                     |
        v                     v
Playwright compiler      semantic executor
        |                     |
        v                     v
source code             LLM-assisted recovery
        |                     |
        +----------+----------+
                   |
                   v
             browser runtime
```

The LLM is primarily used at **compile time**.

Normal production execution should prefer deterministic Playwright code. The LLM-backed executor is a second mode and a recovery mechanism.

---

# 2. Four Operating Configurations

Browser integration and capture policy are independent configuration dimensions.

## 2.1 Browser Integration

### A. `extension`

A Chrome extension attaches to a browser tab that the user is already operating.

Use this when:

- the user wants to demonstrate a task in their everyday browser;
- existing authentication/session state matters;
- the browser should remain under direct human control;
- the workflow is easiest to teach manually.

### B. `controller`

Trace2Code launches or connects to a Chromium browser and owns the browser lifecycle.

Use this when:

- automated reproducibility is more important than using an existing personal browser;
- tests need a clean profile;
- workflows will later run remotely;
- the system needs tighter instrumentation;
- CI should exercise the recorder automatically.

---

## 2.2 Capture Policy

Every recording run chooses one of two capture modes.

### A. `full`

Purpose: maximum fidelity for debugging, research, compiler development, and reproducing a session.

### B. `distilled`

Purpose: efficient production demonstration capture. Discard or aggregate data as early as possible.
