/** Router context for server-rendering the shared live search in page tests. */
export const searchNavigation = {
  useRouter: () => ({}),
  usePathname: () => '/app/search',
  useSearchParams: () => new URLSearchParams(),
};
