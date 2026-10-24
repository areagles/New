import { redirect } from 'next/navigation';

/** The system's front door. */
export default function Home() {
  redirect('/dashboard/');
}
