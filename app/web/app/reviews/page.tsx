import { Shell } from "../../components/Shell";
import { StateMessage } from "../../components/StateMessage";

export default function ReviewsPage() {
  // Only the designated reviewer sees approve actions. Prototype shows the empty state.
  return (
    <Shell current="Reviews">
      <h1>Reviews</h1>
      <StateMessage kind="empty" detail="No submissions are waiting for review in this prototype." />
    </Shell>
  );
}
