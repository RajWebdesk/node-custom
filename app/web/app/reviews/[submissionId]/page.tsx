import { Shell } from "../../../components/Shell";
import { ReviewDetail } from "../../../components/ReviewDetail";

export default async function ReviewPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  return (
    <Shell current="Reviews">
      <ReviewDetail submissionId={submissionId} />
    </Shell>
  );
}
