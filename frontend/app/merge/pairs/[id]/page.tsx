import { redirect } from 'next/navigation';

// A pair's page opens on its analysis report
export default function MergePairPage({ params }: { params: { id: string } }) {
  redirect(`/merge/pairs/${params.id}/report`);
}
