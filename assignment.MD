# AI Shopping Copilot Assignment

## Overview

Build a minimal AI-powered shopping copilot that helps users discover relevant products through a conversational interface.

The system should:

* Understand user intent through natural language conversation.
* Retrieve relevant products from the provided product catalog API.
* Present results clearly within the chat experience.

---

## Evaluation Criteria

Using AI assistants during development is allowed and expected. However, you are responsible for every architectural and implementation decision in the submission.

During the interview, expect detailed discussion around:

* Why specific frameworks or libraries were chosen.
* Why alternative approaches were rejected.
* Retrieval and ranking decisions.
* Anticipated failure modes.
* Trade-offs made during implementation.
* Experiments that were attempted and abandoned.

The goal is to evaluate your judgment and reasoning, not just the final implementation.

A simpler solution that you fully understand and can defend is preferred over a more complex solution that you cannot explain.

---

## Product Catalog API

Use the **DummyJSON Products API** as the product catalog.

**Base URL**

```text
https://dummyjson.com/products
```

An OpenAPI specification is provided:

```text
dummyjson_products_openapi.yaml
```

Use the specification to understand available endpoints, filters, and query parameters.

You do not need to use every endpoint. Select the API capabilities that best support your solution.

---

## Requirements

### 1. Conversational Experience

Users should interact with the system through a chat interface.

### 2. Product Discovery

The system should:

* Understand what the user is looking for.
* Retrieve relevant products from the API.
* Handle natural language shopping requests.

### 3. In-Chat Product Rendering

Product results must be displayed as a UI component inside the chat.

Each product card should include useful information such as:

* Product title
* Short description
* Price
* Product image

Plain-text product listings are not sufficient.

### 4. Conversation Persistence

Conversations should persist across browser refreshes.

Users should not lose chat history when reloading the page.

### 5. Conversation Management

Users should be able to:

* Start a new conversation.
* View a list of previous conversations.
* Resume any prior conversation from its previous state.

### 6. Testing & Evaluation

Include tests or an evaluation suite that validates the core user flow:

```text
User Input
    ↓
Intent Understanding
    ↓
Product Retrieval
    ↓
Response Generation
    ↓
Product Rendering
```

Possible approaches include:

* Unit tests
* Integration tests
* End-to-end tests
* LLM-based evaluations

Choose the approach that best fits your architecture.

---

## Model Access

An OpenAI API key will be provided.

### Allowed Models

* `gpt-5.4-mini`
* `gpt-5.4-nano`

You may choose either model or use both if appropriate.

---

## Technical Freedom

You may use any programming language, framework, or architecture.

Possible options include:

* Mastra
* LangChain
* Vercel AI SDK
* assistant-ui
* CopilotKit
* LibreChat
* A fully custom implementation

The implementation approach is intentionally left open-ended. Use your judgment.

---

## Deliverables

Submit the following:

### 1. Source Code

Complete source code for the application.

### 2. README

Include a README that answers the following questions in your own words.

#### Setup & Run Instructions

* How to install dependencies
* How to configure environment variables
* How to run the application locally
* How to execute tests

#### Architecture & Framework Choice

Explain:

* The architecture you selected
* Why you chose it
* At least two alternatives you considered
* Concrete reasons those alternatives were rejected for this assignment

Examples:

* Custom implementation
* Vercel AI SDK
* LangChain
* Mastra
* assistant-ui

Avoid generic pros/cons; focus on assignment-specific trade-offs.

#### Retrieval Strategy

Describe:

* How user intent is translated into API requests
* Which DummyJSON endpoints are used
* Which query parameters are used and why

Also explain system behavior for:

* Ambiguous queries (e.g., *"something cheap and cool"*)
* Off-catalog queries (e.g., *"a flight to Tokyo"*)
* Multi-intent queries

#### Conversation & State Management

Describe:

* Where conversation persistence is stored
* Why that storage mechanism was chosen

Discuss failure scenarios such as:

* Storage quota exceeded
* Corrupted state
* User clearing storage during a conversation

#### Evaluation Strategy

Explain:

* What your tests or evaluation suite verifies
* Which parts of the system are validated end-to-end
* What regressions would be detected
* What issues could still slip through

#### Known Limitations

Discuss:

* Current weaknesses in the implementation
* Cases where performance or UX is suboptimal
* Improvements you would make with an additional week of development

---

## Notes

* The application only needs to run locally.
* The primary goal is a coherent product discovery experience within a conversational interface.
* Evaluation focuses on your reasoning and decision-making process, not only the final UI.
* The interview will focus on design decisions rather than a code walkthrough.

Expect questions such as:

* Why this approach instead of another?
* What are the failure modes?
* Where does the system break down?
* How does the agent behave under edge cases?

Be prepared to defend any implementation or architectural choice as if you wrote it yourself.
