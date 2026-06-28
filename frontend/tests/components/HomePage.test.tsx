import type { ConversationSummary } from "@bazak/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage from "@/app/page";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/api-client/conversations", () => ({
  listConversations: jest.fn(),
  createConversation: jest.fn(),
}));

import { listConversations } from "@/api-client/conversations";

const listMock = listConversations as jest.Mock;

const conv = (over: Partial<ConversationSummary>): ConversationSummary => ({
  id: "c1",
  title: "A conversation",
  createdAt: "2026-06-28T10:00:00.000Z",
  updatedAt: "2026-06-28T10:00:00.000Z",
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("HomePage (conversations list)", () => {
  it("renders a row per conversation", async () => {
    listMock.mockResolvedValue([
      conv({ id: "c1", title: "Wireless headphones under $100" }),
      conv({ id: "c2", title: "Best-rated smartwatches" }),
    ]);
    render(<HomePage />);
    expect(await screen.findByText("Wireless headphones under $100")).toBeInTheDocument();
    expect(screen.getByText("Best-rated smartwatches")).toBeInTheDocument();
  });

  it("filters by title and shows a no-match state", async () => {
    listMock.mockResolvedValue([
      conv({ id: "c1", title: "Wireless headphones" }),
      conv({ id: "c2", title: "Gaming laptop deals" }),
    ]);
    render(<HomePage />);
    await screen.findByText("Wireless headphones");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search conversations"), "laptop");
    expect(screen.getByText("Gaming laptop deals")).toBeInTheDocument();
    expect(screen.queryByText("Wireless headphones")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search conversations"));
    await user.type(screen.getByLabelText("Search conversations"), "drone");
    expect(screen.getByText(/No conversations match/)).toBeInTheDocument();
  });

  it("shows the first-run empty state when there are no conversations", async () => {
    listMock.mockResolvedValue([]);
    render(<HomePage />);
    expect(await screen.findByTestId("first-run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a conversation" })).toBeInTheDocument();
  });
});
