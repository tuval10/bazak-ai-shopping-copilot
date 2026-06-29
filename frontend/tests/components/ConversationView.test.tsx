import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TurnState } from "@/api-client/turn";
import { ConversationView } from "@/components/chat/ConversationView";
import { mockGroup } from "../mocks/product-results";

jest.mock("@/api-client/turn", () => ({ runTurn: jest.fn() }));
jest.mock("@/api-client/conversations", () => ({
  getMessages: jest.fn(),
  renameConversation: jest.fn().mockResolvedValue(undefined),
}));

import { getMessages } from "@/api-client/conversations";
import { runTurn } from "@/api-client/turn";

const getMessagesMock = getMessages as jest.Mock;
const runTurnMock = runTurn as jest.Mock;

function streamOf(states: TurnState[]) {
  return async function* () {
    for (const s of states) yield s;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getMessagesMock.mockResolvedValue([]);
});

describe("ConversationView", () => {
  it("shows the empty state with example prompts when there's no history", async () => {
    render(<ConversationView threadId="t1" />);
    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "best-rated headphones" })).toBeInTheDocument();
  });

  it("optimistically shows the user message, then renders the streamed cards + summary", async () => {
    const group = mockGroup({ intent: "headphones under $100" });
    runTurnMock.mockImplementation(
      streamOf([
        { groups: [], chips: [], text: "", status: "streaming" },
        { groups: [group], chips: [], text: "", status: "streaming" },
        { groups: [group], chips: [], text: "Here are the cheapest options 👇", status: "done" },
      ]),
    );

    render(<ConversationView threadId="t1" />);
    await screen.findByTestId("empty-state");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message Bazak"), "wireless headphones under $100");
    await user.click(screen.getByLabelText("Send"));

    // Optimistic echo of the user's message (shown in the bubble and the header title).
    expect(screen.getAllByText("wireless headphones under $100").length).toBeGreaterThanOrEqual(1);

    // Assistant prose + product cards once the turn completes.
    expect(await screen.findByText("Here are the cheapest options 👇")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("product-group")).toBeInTheDocument());
    expect(screen.getAllByTestId("product-card").length).toBeGreaterThan(0);
  });

  it("renders suggestion chips and autofills the composer when one is tapped", async () => {
    const chips = [{ label: "Under $50", message: "only show the ones under $50" }];
    runTurnMock.mockImplementation(
      streamOf([
        { groups: [], chips, text: "Here are some picks", status: "done" },
      ]),
    );

    render(<ConversationView threadId="t1" />);
    await screen.findByTestId("empty-state");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message Bazak"), "phones");
    await user.click(screen.getByLabelText("Send"));

    const chip = await screen.findByRole("button", { name: "Under $50" });
    await user.click(chip);

    // The chip's message is dropped into the composer (editable, not auto-sent).
    expect(screen.getByLabelText("Message Bazak")).toHaveValue("only show the ones under $50");
  });

  it("renders an error bubble with Retry when the turn fails, then recovers", async () => {
    runTurnMock.mockImplementationOnce(() => {
      throw new Error("network");
    });

    render(<ConversationView threadId="t1" />);
    await screen.findByTestId("empty-state");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message Bazak"), "best 4k monitors");
    await user.click(screen.getByLabelText("Send"));

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry).toBeInTheDocument();

    // Retry succeeds this time.
    runTurnMock.mockImplementation(
      streamOf([{ groups: [], chips: [], text: "Found these.", status: "done" }]),
    );
    await user.click(retry);
    expect(await screen.findByText("Found these.")).toBeInTheDocument();
  });

  it("surfaces a storage error if history can't load (US-5.2)", async () => {
    getMessagesMock.mockRejectedValue(new Error("storage"));
    render(<ConversationView threadId="t1" />);
    expect(await screen.findByText(/Couldn't load this conversation/)).toBeInTheDocument();
  });
});
