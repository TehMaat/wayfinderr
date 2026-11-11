'use client';

import { MergeReportPage } from '@/components/merge-pair-page';

// Dyadrr's merge report of a pair: the analysis again, the build and the verification
export default function PairMergeReportPage({ params }: { params: { id: string } }) {
  return <MergeReportPage id={params.id} merge />;
}
