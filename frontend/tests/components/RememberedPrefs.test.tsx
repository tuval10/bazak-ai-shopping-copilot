import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RememberedPrefs } from "@/components/profile/RememberedPrefs";

jest.mock("@/api-client/profile", () => ({
  getProfile: jest.fn(),
  resetProfile: jest.fn(),
}));

import { getProfile, resetProfile } from "@/api-client/profile";

const getProfileMock = getProfile as jest.Mock;
const resetProfileMock = resetProfile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetProfileMock.mockResolvedValue(undefined);
});

describe("RememberedPrefs", () => {
  it("reveals remembered fields on open and resets them", async () => {
    getProfileMock.mockResolvedValue([
      { label: "Budget", value: "~$50" },
      { label: "Preferred brands", value: "Apple, Beats" },
    ]);
    const user = userEvent.setup();
    render(<RememberedPrefs />);

    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(await screen.findByText("~$50")).toBeInTheDocument();
    expect(screen.getByText("Apple, Beats")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset everything" }));
    expect(resetProfileMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Nothing remembered yet/)).toBeInTheDocument());
  });

  it("shows an empty state when nothing is remembered", async () => {
    getProfileMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RememberedPrefs />);
    await user.click(screen.getByRole("button", { name: "Remembered" }));
    expect(await screen.findByText(/Nothing remembered yet/)).toBeInTheDocument();
  });
});
