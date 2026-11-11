'use client';

import { MergeReportPage } from '@/components/merge-pair-page';

// Dyadrr's analysis report of a pair, in sections (TehMaat/wayfinderr#58)
export default function PairReportPage({ params }: { params: { id: string } }) {
  return <MergeReportPage id={params.id} merge={false} />;
}
