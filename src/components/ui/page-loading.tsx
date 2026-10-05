import { PageHeader } from './page-header';

/** Static placeholders avoid decorative motion and expose one concise loading announcement. */
export function PageLoading({ title, message }: { title: string; message: string }) {
  return <div className="page">
    <PageHeader title={title}/>
    <section className="page-loading" role="status" aria-live="polite" aria-atomic="true">
      <p>{message}</p>
      <div className="page-loading-placeholder" aria-hidden="true"><span/><span/><span/></div>
    </section>
  </div>;
}
