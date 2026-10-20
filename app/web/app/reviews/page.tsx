import { Shell } from "../../components/Shell";
import { ReviewQueue } from "../../components/ReviewQueue";

export default function ReviewsPage() {
  return (
    <Shell current="Reviews">
      <h1>Reviews</h1>
      <ReviewQueue />
    </Shell>
  );
}
