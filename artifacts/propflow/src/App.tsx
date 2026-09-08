import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDownRight, ArrowUpRight, Building2, CalendarRange, Check, ChevronRight, CircleDollarSign, ClipboardList, Home, LayoutDashboard, LogOut, Menu, MoreHorizontal, Pencil, Plus, ReceiptIndianRupee, Search, Sparkles, Trash2, UserCog, UserMinus, UserPlus, WalletCards, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { ErrorBoundary } from '@/components/error-boundary';
import { EmptyState, Field, formatDate, formatMoney, Modal, SectionTitle, SkeletonRows, Surface, inputClass } from '@/components/propflow-ui';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import NotFound from '@/pages/not-found';
import {
  getGetAuthStatusQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetMeQueryKey,
  getListActivityQueryKey,
  getListFlatPaymentsQueryKey,
  getListFlatsQueryKey,
  getListPropertiesQueryKey,
  ApiError,
  useChangePin,
  useCreateFlat,
  useCreatePayment,
  useCreateProperty,
  useDeleteFlat,
  useDeleteProperty,
  useGetAuthStatus,
  useGetDashboardSummary,
  useGetMe,
  useHealthCheck,
  useListActivity,
  useListFlatPayments,
  useListFlats,
  useListProperties,
  useLogin,
  useLogout,
  useRenewFlat,
  useSetupOwner,
  useUpdateFlat,
  useUpdateMe,
  useUpdateProperty,
  useVacateFlat,
  type Flat,
  type Owner,
  type Property,
} from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

// Selecting a day in the calendar creates a Date at LOCAL midnight; reading
// it back with .toISOString() (UTC) would reintroduce the exact off-by-one
// bug already fixed server-side for move-in/payment dates. Keep the
// conversion local-to-local in both directions instead.
function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const queryClient = new QueryClient();

type View = 'overview' | 'ledger';
type Notice = { tone: 'success' | 'error'; text: string };

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview & setup', icon: LayoutDashboard },
  { id: 'ledger', label: 'Rent ledger', icon: ReceiptIndianRupee },
];

function AppShell({ owner }: { owner: Owner }) {
  const [view, setView] = useState<View>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [propertyModal, setPropertyModal] = useState(false);
  const [flatModal, setFlatModal] = useState(false);
  const [tenantModal, setTenantModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [editingFlat, setEditingFlat] = useState<Flat | null>(null);
  const [editingTenantFlat, setEditingTenantFlat] = useState<Flat | null>(null);
  const [selectedFlat, setSelectedFlat] = useState<Flat | null>(null);
  const [propertyForm, setPropertyForm] = useState({ name: '', address: '', unitNumbers: [''] });
  const [flatForm, setFlatForm] = useState({ propertyId: '', flatNo: '' });
  const [tenantForm, setTenantForm] = useState({ flatId: '', tenantName: '', workplace: '', govtId: '', moveInDate: '', tenureEnd: '', deposit: '', rent: '' });
  const [paymentForm, setPaymentForm] = useState({ paymentDate: new Date().toISOString().slice(0, 10), amount: '' });
  const [expiredFlat, setExpiredFlat] = useState<Flat | null>(null);
  const [renewForm, setRenewForm] = useState({ tenureEnd: '', rent: '' });
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');

  const queryClient = useQueryClient();
  const health = useHealthCheck();
  const propertiesQuery = useListProperties();
  const flatsQuery = useListFlats();
  const summaryQuery = useGetDashboardSummary();
  const activityQuery = useListActivity();
  const paymentsQuery = useListFlatPayments(selectedFlat?.id ?? '', {
    query: { enabled: !!selectedFlat?.id, queryKey: getListFlatPaymentsQueryKey(selectedFlat?.id ?? '') },
  });
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();
  const createFlat = useCreateFlat();
  const updateFlat = useUpdateFlat();
  const deleteFlat = useDeleteFlat();
  const renewFlat = useRenewFlat();
  const vacateFlat = useVacateFlat();
  const createPayment = useCreatePayment();
  const logout = useLogout();

  const properties = propertiesQuery.data ?? [];
  const flats = flatsQuery.data ?? [];
  const summary = summaryQuery.data;
  const activities = activityQuery.data ?? [];
  const isInitialLoading = propertiesQuery.isLoading || flatsQuery.isLoading || summaryQuery.isLoading;
  const isAnyError = propertiesQuery.isError || flatsQuery.isError || summaryQuery.isError || activityQuery.isError;
  const vacantFlats = useMemo(() => flats.filter((flat) => !flat.isOccupied), [flats]);
  const filteredFlats = useMemo(() => flats.filter((flat) => {
    const query = ledgerSearch.toLowerCase();
    const matchesSearch = !query || [flat.flatNo, flat.tenantName ?? '', flat.propertyName].some((value) => value.toLowerCase().includes(query));
    const matchesProperty = propertyFilter === 'all' || flat.propertyId === propertyFilter;
    return matchesSearch && matchesProperty;
  }), [flats, ledgerSearch, propertyFilter]);

  // selectedFlat is a snapshot captured when a row was clicked, so it goes
  // stale the moment `flats` refetches with new data (e.g. right after
  // recording a payment updates totalPaid) - the detail panel would keep
  // showing the old figures until the flat was reselected. Re-point it at
  // the current copy from the live list whenever that list changes.
  useEffect(() => {
    if (!selectedFlat) return;
    const fresh = flats.find((flat) => flat.id === selectedFlat.id);
    if (fresh && fresh !== selectedFlat) setSelectedFlat(fresh);
  }, [flats]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const refreshOverview = () => {
    queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListFlatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
  };

  const openCreateProperty = () => {
    setEditingProperty(null);
    setPropertyForm({ name: '', address: '', unitNumbers: [''] });
    setPropertyModal(true);
  };

  const openEditProperty = (property: Property) => {
    setEditingProperty(property);
    setPropertyForm({ name: property.name, address: property.address, unitNumbers: [''] });
    setPropertyModal(true);
  };

  const submitProperty = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!propertyForm.name.trim() || !propertyForm.address.trim()) return;
    const onSuccess = (unitsAdded: number) => {
      setPropertyModal(false);
      refreshOverview();
      setNotice({
        tone: 'success',
        text: editingProperty ? 'Property details updated.' : unitsAdded
          ? `Property added with ${unitsAdded} unit${unitsAdded === 1 ? '' : 's'}.`
          : 'Property added to your workspace.',
      });
    };
    if (editingProperty) {
      updateProperty.mutate({ id: editingProperty.id, data: { name: propertyForm.name, address: propertyForm.address } }, { onSuccess: () => onSuccess(0) });
    } else {
      const unitNumbers = [...new Set(propertyForm.unitNumbers.map((value) => value.trim()).filter(Boolean))];
      createProperty.mutate({ data: { name: propertyForm.name, address: propertyForm.address, unitNumbers } }, { onSuccess: () => onSuccess(unitNumbers.length) });
    }
  };

  const removeProperty = (property: Property) => {
    if (!window.confirm(`Remove ${property.name}? This cannot be undone.`)) return;
    deleteProperty.mutate({ id: property.id }, {
      onSuccess: () => {
        refreshOverview();
        setNotice({ tone: 'success', text: `${property.name} removed.` });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not remove that property.' }),
    });
  };

  const openCreateFlat = (propertyId = properties[0]?.id ?? '') => {
    setEditingFlat(null);
    setFlatForm({ propertyId, flatNo: '' });
    setFlatModal(true);
  };

  const openEditFlat = (flat: Flat) => {
    setEditingFlat(flat);
    setFlatForm({ propertyId: flat.propertyId, flatNo: flat.flatNo });
    setFlatModal(true);
  };

  const openAssignTenant = (propertyId = '') => {
    setEditingTenantFlat(null);
    const defaultFlat = vacantFlats.find((flat) => !propertyId || flat.propertyId === propertyId) ?? vacantFlats[0];
    setTenantForm({ flatId: defaultFlat?.id ?? '', tenantName: '', workplace: '', govtId: '', moveInDate: '', tenureEnd: '', deposit: '', rent: '' });
    setTenantModal(true);
  };

  const openEditTenant = (flat: Flat) => {
    setEditingTenantFlat(flat);
    setTenantForm({
      flatId: flat.id, tenantName: flat.tenantName ?? '', workplace: flat.workplace ?? '', govtId: flat.govtId ?? '',
      moveInDate: flat.moveInDate?.slice(0, 10) ?? '', tenureEnd: flat.tenureEnd?.slice(0, 10) ?? '',
      deposit: flat.deposit != null ? String(flat.deposit) : '', rent: flat.rent != null ? String(flat.rent) : '',
    });
    setTenantModal(true);
  };

  const openEditFlatOrTenant = (flat: Flat) => (flat.isOccupied ? openEditTenant(flat) : openEditFlat(flat));

  const openResolveExpired = (flat: Flat) => {
    setExpiredFlat(flat);
    setRenewForm({ tenureEnd: '', rent: flat.rent != null ? String(flat.rent) : '' });
  };

  const submitRenew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!expiredFlat || !renewForm.tenureEnd || !renewForm.rent) return;
    renewFlat.mutate({ id: expiredFlat.id, data: { tenureEnd: renewForm.tenureEnd, rent: Number(renewForm.rent) || 0 } }, {
      onSuccess: () => {
        setExpiredFlat(null);
        refreshOverview();
        setNotice({ tone: 'success', text: `Lease renewed for ${expiredFlat.tenantName}.` });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not renew that lease.' }),
    });
  };

  const submitFlat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flatForm.propertyId || !flatForm.flatNo.trim()) return;
    const onSuccess = () => {
      setFlatModal(false);
      refreshOverview();
      setNotice({ tone: 'success', text: editingFlat ? 'Unit details updated.' : 'Unit added. Assign a tenant when it is occupied.' });
    };
    if (editingFlat) {
      updateFlat.mutate({ id: editingFlat.id, data: { flatNo: flatForm.flatNo } }, { onSuccess });
    } else {
      createFlat.mutate({ data: { propertyId: flatForm.propertyId, flatNo: flatForm.flatNo } }, { onSuccess });
    }
  };

  const submitTenant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantForm.flatId || !tenantForm.tenantName.trim() || !tenantForm.rent || !tenantForm.moveInDate || !tenantForm.tenureEnd) return;
    updateFlat.mutate({
      id: tenantForm.flatId,
      data: {
        tenantName: tenantForm.tenantName, workplace: tenantForm.workplace, govtId: tenantForm.govtId,
        moveInDate: tenantForm.moveInDate, tenureEnd: tenantForm.tenureEnd,
        deposit: Number(tenantForm.deposit) || 0, rent: Number(tenantForm.rent) || 0,
      },
    }, {
      onSuccess: () => {
        setTenantModal(false);
        refreshOverview();
        setNotice({ tone: 'success', text: editingTenantFlat ? 'Tenant details updated.' : 'Tenant mapped to the unit.' });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not save the tenant details.' }),
    });
  };

  const removeFlat = (flat: Flat) => {
    if (!window.confirm(`Delete unit ${flat.flatNo}? This removes the unit itself and cannot be undone.`)) return;
    deleteFlat.mutate({ id: flat.id }, {
      onSuccess: () => {
        refreshOverview();
        if (selectedFlat?.id === flat.id) setSelectedFlat(null);
        if (expiredFlat?.id === flat.id) setExpiredFlat(null);
        setNotice({ tone: 'success', text: `Unit ${flat.flatNo} removed.` });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not remove that unit.' }),
    });
  };

  const vacateFlatAction = (flat: Flat) => {
    if (!window.confirm(`Vacate unit ${flat.flatNo}? This clears the tenant but keeps the unit for the next one.`)) return;
    vacateFlat.mutate({ id: flat.id }, {
      onSuccess: () => {
        refreshOverview();
        if (expiredFlat?.id === flat.id) setExpiredFlat(null);
        setNotice({ tone: 'success', text: `Unit ${flat.flatNo} is now vacant.` });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not vacate that unit.' }),
    });
  };

  const openPayment = (flat: Flat) => {
    setSelectedFlat(flat);
    setPaymentForm({ paymentDate: new Date().toISOString().slice(0, 10), amount: flat.rent != null ? String(flat.rent) : '' });
    setPaymentModal(true);
  };

  const submitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFlat || !paymentForm.amount) return;
    createPayment.mutate({ id: selectedFlat.id, data: { paymentDate: paymentForm.paymentDate, amount: Number(paymentForm.amount) } }, {
      onSuccess: () => {
        setPaymentModal(false);
        refreshOverview();
        queryClient.invalidateQueries({ queryKey: getListFlatPaymentsQueryKey(selectedFlat.id) });
        setNotice({ tone: 'success', text: `Payment recorded for ${selectedFlat.tenantName ?? selectedFlat.flatNo}.` });
      },
      onError: () => setNotice({ tone: 'error', text: 'Could not record the payment.' }),
    });
  };

  const retryQueries = () => {
    propertiesQuery.refetch();
    flatsQuery.refetch();
    summaryQuery.refetch();
    activityQuery.refetch();
  };

  const doLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        const authStatusKey = getGetAuthStatusQueryKey()[0];
        const meKey = getGetMeQueryKey()[0];
        // Drop every other cached query (tenant/property data etc.) so it
        // isn't left sitting in memory after logout. auth/status is kept so
        // AuthGate doesn't misread "no owner" while re-checking (see the
        // comment on that check below); auth/me is handled separately next.
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== authStatusKey && query.queryKey[0] !== meKey,
        });
        // invalidateQueries (not removeQueries) for auth/me specifically:
        // removeQueries only deletes the cache entry, it does not trigger a
        // refetch - the already-mounted useGetMe observer in AuthGate would
        // just keep showing its last (still-authenticated) result until
        // something else remounted it, so logging out never actually
        // navigated to LoginScreen without a manual page reload.
        // invalidateQueries explicitly refetches active observers, which
        // gets the real (401) result and lets AuthGate switch over.
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
    });
  };

  const ownerInitials = owner.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'PF';
  const firstName = owner.name.trim().split(/\s+/)[0] ?? owner.name;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const monthYearLabel = `${now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} / ${now.getFullYear()}`;

  return (
    <div className="noise flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[270px] flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] px-5 py-6 transition-transform duration-300 md:static md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]"><Building2 size={19} strokeWidth={2.5} /></div>
          <div><p className="display text-[18px] font-bold tracking-[-.06em] text-[hsl(var(--sidebar-foreground))]">PropFlow</p><p className="mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.5)]">operator workspace</p></div>
        </div>
        <div className="mt-12 px-3"><p className="mono mb-3 text-[9px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.42)]">Workspace</p>
          <nav className="space-y-1">
            {navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setView(id); setMobileNav(false); }} data-testid={`button-nav-${id}`} className={`group flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${view === id ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-accent)/.65)] hover:text-[hsl(var(--sidebar-foreground))]'}`}><Icon size={17} className={view === id ? 'text-[hsl(var(--sidebar-primary))]' : ''} /><span>{label}</span>{id === 'ledger' && summary?.dueForRevision ? <span className="mono ml-auto rounded-full bg-[hsl(var(--accent))] px-1.5 py-0.5 text-[9px] font-medium text-[hsl(var(--accent-foreground))]">{summary.dueForRevision}</span> : null}</button>)}
          </nav>
        </div>
        <div className="relative mt-auto px-1">
          <button type="button" onClick={() => setSidebarMenuOpen((open) => !open)} data-testid="button-sidebar-account-menu" className="flex w-full items-center gap-3 rounded-[11px] border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.5)] p-3 text-left transition-colors hover:bg-[hsl(var(--sidebar-accent))]"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[11px] font-bold text-[hsl(var(--accent-foreground))]">{ownerInitials}</div><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-[hsl(var(--sidebar-foreground))]">{owner.name}</p><p className="truncate text-[10px] text-[hsl(var(--sidebar-foreground)/.48)]">Portfolio owner</p></div><MoreHorizontal size={15} className="ml-auto shrink-0 text-[hsl(var(--sidebar-foreground)/.42)]" /></button>
          <AccountMenu open={sidebarMenuOpen} onClose={() => setSidebarMenuOpen(false)} onOpenProfile={() => setProfileModal(true)} onLogout={doLogout} anchor="bottom" />
        </div>
      </aside>
      {mobileNav && <button type="button" aria-label="Close navigation" data-testid="button-close-navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-20 bg-[hsl(var(--foreground)/.35)] md:hidden" />}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-[70px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3"><button type="button" onClick={() => setMobileNav(true)} data-testid="button-open-navigation" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden"><Menu size={19} /></button><div><p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{todayLabel}</p><h1 className="display mt-0.5 text-[18px] font-semibold tracking-[-.035em]">{view === 'overview' ? `${greeting}, ${firstName}` : 'Rent ledger'}</h1></div></div>
          <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-3 py-1.5 sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary))]'}`} /><span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{health.isError ? 'offline' : 'live sync'}</span></div><button type="button" onClick={() => openCreateProperty()} data-testid="button-header-add-property" className="hidden items-center gap-2 rounded-[9px] bg-[hsl(var(--primary))] px-3 py-2 text-[12px] font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition-transform hover:-translate-y-0.5 sm:flex"><Plus size={15} />Add property</button><div className="relative"><button type="button" onClick={() => setHeaderMenuOpen((open) => !open)} data-testid="button-header-account-menu" className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[11px] font-bold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))]">{ownerInitials}</button><AccountMenu open={headerMenuOpen} onClose={() => setHeaderMenuOpen(false)} onOpenProfile={() => setProfileModal(true)} onLogout={doLogout} anchor="top-right" /></div></div>
        </header>
        <div className="workspace-grid mx-auto min-h-[calc(100dvh-70px)] max-w-[1600px] px-5 py-8 sm:px-8 lg:px-12">
          {notice && <div data-testid="status-notice" className={`animate-rise-in mb-5 flex items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-[12px] font-semibold ${notice.tone === 'success' ? 'border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full ${notice.tone === 'success' ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]'}`}>{notice.tone === 'success' ? <Check size={13} /> : <X size={13} />}</span>{notice.text}<button type="button" data-testid="button-dismiss-notice" onClick={() => setNotice(null)} className="ml-auto opacity-60 hover:opacity-100"><X size={14} /></button></div>}
          {isAnyError ? <ErrorState onRetry={retryQueries} /> : isInitialLoading ? <WorkspaceSkeleton /> : view === 'overview' ? <Overview properties={properties} flats={flats} summary={summary} activities={activities} onAddProperty={openCreateProperty} onEditProperty={openEditProperty} onDeleteProperty={removeProperty} onAddFlat={openCreateFlat} onAssignTenant={openAssignTenant} onSelectFlat={setSelectedFlat} /> : <Ledger flats={filteredFlats} allFlats={flats} properties={properties} search={ledgerSearch} onSearch={setLedgerSearch} propertyFilter={propertyFilter} onPropertyFilter={setPropertyFilter} onAddFlat={openCreateFlat} onEditFlat={openEditFlatOrTenant} onDeleteFlat={removeFlat} onRecordPayment={openPayment} onSelectFlat={setSelectedFlat} onResolveExpired={openResolveExpired} onAssignTenant={openAssignTenant} onVacate={vacateFlatAction} />}
        </div>
      </main>
      <PropertyModal open={propertyModal} editing={editingProperty} form={propertyForm} setForm={setPropertyForm} onClose={() => setPropertyModal(false)} onSubmit={submitProperty} pending={createProperty.isPending || updateProperty.isPending} />
      <FlatModal open={flatModal} editing={editingFlat} form={flatForm} setForm={setFlatForm} properties={properties} onClose={() => setFlatModal(false)} onSubmit={submitFlat} pending={createFlat.isPending || updateFlat.isPending} />
      <TenantModal open={tenantModal} editing={editingTenantFlat} form={tenantForm} setForm={setTenantForm} vacantFlats={vacantFlats} onClose={() => setTenantModal(false)} onSubmit={submitTenant} pending={updateFlat.isPending} />
      <PaymentModal open={paymentModal} flat={selectedFlat} form={paymentForm} setForm={setPaymentForm} onClose={() => setPaymentModal(false)} onSubmit={submitPayment} pending={createPayment.isPending} />
      <ExpiredLeaseModal flat={expiredFlat} form={renewForm} setForm={setRenewForm} onClose={() => setExpiredFlat(null)} onSubmitRenew={submitRenew} onVacate={() => expiredFlat && vacateFlatAction(expiredFlat)} renewPending={renewFlat.isPending} />
      <ProfileModal open={profileModal} owner={owner} onClose={() => setProfileModal(false)} onNotice={setNotice} />
      {selectedFlat && <FlatDetail flat={selectedFlat} payments={paymentsQuery.data ?? []} loading={paymentsQuery.isLoading} onClose={() => setSelectedFlat(null)} onEdit={() => (selectedFlat.isOccupied ? openEditTenant(selectedFlat) : openEditFlat(selectedFlat))} onRecordPayment={() => openPayment(selectedFlat)} onResolveExpired={() => openResolveExpired(selectedFlat)} onAssignTenant={() => openAssignTenant(selectedFlat.propertyId)} onVacate={() => vacateFlatAction(selectedFlat)} onDeleteUnit={() => removeFlat(selectedFlat)} />}
    </div>
  );
}

function AccountMenu({ open, onClose, onOpenProfile, onLogout, anchor }: { open: boolean; onClose: () => void; onOpenProfile: () => void; onLogout: () => void; anchor: 'bottom' | 'top-right' }) {
  if (!open) return null;
  const position = anchor === 'bottom' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2';
  return <>
    <button type="button" aria-label="Close menu" onClick={onClose} className="fixed inset-0 z-40 cursor-default" />
    <div className={`absolute z-50 w-[200px] overflow-hidden rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1.5 shadow-[var(--shadow-md)] ${position}`}>
      <button type="button" onClick={() => { onOpenProfile(); onClose(); }} data-testid="button-open-profile-settings" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"><UserCog size={14} />Profile settings</button>
      <button type="button" onClick={() => { onLogout(); onClose(); }} data-testid="button-logout" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-semibold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)]"><LogOut size={14} />Log out</button>
    </div>
  </>;
}

function ProfileModal({ open, owner, onClose, onNotice }: { open: boolean; owner: Owner; onClose: () => void; onNotice: (notice: Notice) => void }) {
  const [form, setForm] = useState({ name: owner.name, phone: owner.phone ?? '' });
  const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '' });
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const changePin = useChangePin();

  useEffect(() => {
    if (open) {
      setForm({ name: owner.name, phone: owner.phone ?? '' });
      setPinForm({ currentPin: '', newPin: '' });
    }
  }, [open, owner]);

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateMe.mutate({ data: { name: form.name, phone: form.phone } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        onNotice({ tone: 'success', text: 'Profile updated.' });
      },
      onError: () => onNotice({ tone: 'error', text: 'Could not update your profile.' }),
    });
  };

  const submitPin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pinForm.currentPin) || !/^\d{4}$/.test(pinForm.newPin)) return;
    changePin.mutate({ data: pinForm }, {
      onSuccess: () => {
        setPinForm({ currentPin: '', newPin: '' });
        onNotice({ tone: 'success', text: 'PIN changed.' });
      },
      onError: (error) => onNotice({
        tone: 'error',
        text: error instanceof ApiError && typeof error.data === 'object' && error.data && 'error' in error.data
          ? String((error.data as { error: unknown }).error)
          : 'Could not change your PIN. Check your current PIN.',
      }),
    });
  };

  return <Modal open={open} title="Profile settings" description="Update the owner details for this workspace." onClose={onClose}>
    <form onSubmit={submitProfile} className="space-y-4">
      <Field label="Name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="input-profile-name" className={inputClass()} /></Field>
      <Field label="Phone" hint="Optional"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} data-testid="input-profile-phone" className={inputClass()} placeholder="Optional" /></Field>
      <div className="flex justify-end pt-1"><button type="submit" disabled={updateMe.isPending} data-testid="button-save-profile" className="rounded-[8px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{updateMe.isPending ? 'Saving...' : 'Save changes'}</button></div>
    </form>
    <div className="mt-8 border-t border-[hsl(var(--border))] pt-6">
      <h3 className="text-[13px] font-bold">Change PIN</h3>
      <form onSubmit={submitPin} className="mt-4 space-y-4">
        <Field label="Current PIN"><input required type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pinForm.currentPin} onChange={(event) => setPinForm({ ...pinForm, currentPin: event.target.value.replace(/\D/g, '').slice(0, 4) })} data-testid="input-current-pin" className={inputClass()} /></Field>
        <Field label="New PIN" hint="4 digits"><input required type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pinForm.newPin} onChange={(event) => setPinForm({ ...pinForm, newPin: event.target.value.replace(/\D/g, '').slice(0, 4) })} data-testid="input-new-pin" className={inputClass()} /></Field>
        <div className="flex justify-end pt-1"><button type="submit" disabled={changePin.isPending} data-testid="button-change-pin" className="rounded-[8px] border border-[hsl(var(--border))] px-4 py-2.5 text-[12px] font-bold disabled:opacity-50">{changePin.isPending ? 'Updating...' : 'Update PIN'}</button></div>
      </form>
    </div>
  </Modal>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="flex min-h-[420px] items-center justify-center"><div className="max-w-[380px] text-center"><div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]"><ArrowDownRight size={23} /></div><h2 className="display text-[20px] font-semibold">The workspace missed a beat</h2><p className="mt-2 text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">We couldn't load your latest property data. Your records are safe.</p><button type="button" onClick={onRetry} data-testid="button-retry-workspace" className="mt-5 rounded-[9px] bg-[hsl(var(--foreground))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--background))] transition-transform hover:-translate-y-0.5">Try again</button></div></div>;
}

function WorkspaceSkeleton() {
  return <div className="animate-rise-in"><div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-[128px] rounded-[14px]" />)}</div><div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><div className="skeleton h-[310px] rounded-[14px]" /><div className="skeleton h-[310px] rounded-[14px]" /></div></div>;
}

function Metric({ label, value, detail, icon: Icon, accent, trend }: { label: string; value: string; detail: string; icon: typeof WalletCards; accent: string; trend?: 'up' | 'down' }) {
  return <Surface className="group relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[var(--shadow-md)]"><div className={`absolute -right-5 -top-5 h-28 w-28 rounded-full ${accent} opacity-[.12] blur-[1px] transition-transform duration-500 group-hover:scale-150`} /><div className="relative mb-7 flex items-center justify-between"><span className="mono text-[9px] font-medium uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">{label}</span><span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.36)]"><Icon size={15} className="text-[hsl(var(--muted-foreground))]" /></span></div><p data-testid={`text-metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="relative display text-[29px] font-semibold tracking-[-.07em]">{value}</p><div className="relative mt-3 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">{trend && <span className={trend === 'up' ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'}>{trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}</span>}{detail}</div></Surface>;
}

function Overview({ properties, flats, summary, activities, onAddProperty, onEditProperty, onDeleteProperty, onAddFlat, onAssignTenant, onSelectFlat }: { properties: Property[]; flats: Flat[]; summary?: { expectedMonthlyRevenue: number; totalCollected: number; occupiedUnits: number; totalUnits: number; propertiesCount: number; dueForRevision: number }; activities: { id: string; type: string; title: string; description: string; createdAt: string }[]; onAddProperty: () => void; onEditProperty: (property: Property) => void; onDeleteProperty: (property: Property) => void; onAddFlat: (propertyId?: string) => void; onAssignTenant: (propertyId?: string) => void; onSelectFlat: (flat: Flat) => void }) {
  const occupancy = summary && summary.totalUnits ? Math.round((summary.occupiedUnits / summary.totalUnits) * 100) : 0;
  const monthYearLabel = `${new Date().toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} / ${new Date().getFullYear()}`;
  return <div className="animate-rise-in space-y-8">
    <section className="relative overflow-hidden rounded-[24px] border border-[hsl(var(--border))] bg-[linear-gradient(120deg,hsl(var(--sidebar))_0%,hsl(231_29%_13%)_58%,hsl(240_35%_18%)_100%)] p-6 shadow-[var(--shadow-md)] sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.08)] blur-[1px]" />
      <div className="pointer-events-none absolute bottom-[-120px] right-[22%] h-64 w-64 rounded-full border border-[hsl(var(--accent)/.15)]" />
      <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div className="max-w-[650px]">
          <div className="mb-5 flex items-center gap-2"><span className="pulse-dot h-2 w-2 rounded-full bg-[hsl(var(--accent))]" /><span className="mono text-[9px] uppercase tracking-[.22em] text-[hsl(var(--sidebar-foreground)/.6)]">Live portfolio control center</span></div>
          <h2 className="display text-balance text-[32px] font-semibold leading-[1.05] tracking-[-.065em] text-[hsl(var(--sidebar-foreground))] sm:text-[44px]">Stay ahead of<br /><span className="text-[hsl(var(--sidebar-primary))]">every lease.</span></h2>
          <p className="mt-5 max-w-[480px] text-[13px] leading-6 text-[hsl(var(--sidebar-foreground)/.62)]">One clear view of the places, people, and payments that keep your portfolio moving.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:min-w-[330px]">
          <div className="rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5"><p className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--sidebar-foreground)/.48)]">Properties</p><p className="mt-2 display text-[22px] font-semibold text-[hsl(var(--sidebar-foreground))]">{summary?.propertiesCount ?? 0}</p></div>
          <div className="rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5"><p className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--sidebar-foreground)/.48)]">Live leases</p><p className="mt-2 display text-[22px] font-semibold text-[hsl(var(--sidebar-foreground))]">{summary?.occupiedUnits ?? 0}</p></div>
          <div className="col-span-2 rounded-2xl border border-[hsl(var(--sidebar-primary)/.22)] bg-[hsl(var(--sidebar-primary)/.1)] p-3.5 sm:col-span-1"><p className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--sidebar-primary)/.7)]">Attention</p><p className="mt-2 display text-[22px] font-semibold text-[hsl(var(--sidebar-primary))]">{String(summary?.dueForRevision ?? 0).padStart(2, '0')}</p></div>
        </div>
      </div>
    </section>
    <section><div className="mb-4 flex items-end justify-between"><div><p className="mono mb-1 text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Portfolio pulse</p><h2 className="display text-[21px] font-semibold tracking-[-.045em]">Your numbers, at a glance.</h2></div><p className="hidden text-right text-[12px] text-[hsl(var(--muted-foreground))] sm:block">Updated moments ago<br /><span className="mono text-[10px]">{monthYearLabel}</span></p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Expected this month" value={formatMoney(summary?.expectedMonthlyRevenue)} detail="across active leases" icon={WalletCards} accent="bg-[hsl(var(--primary))]" trend="up" /><Metric label="Collected this month" value={formatMoney(summary?.totalCollected)} detail={`${summary?.expectedMonthlyRevenue ? Math.round((summary.totalCollected / summary.expectedMonthlyRevenue) * 100) : 0}% of expected`} icon={CircleDollarSign} accent="bg-[hsl(var(--accent))]" trend="up" /><Metric label="Occupied units" value={`${summary?.occupiedUnits ?? 0} / ${summary?.totalUnits ?? 0}`} detail={`${occupancy}% portfolio occupancy`} icon={Home} accent="bg-[hsl(var(--chart-3))]" /><Metric label="Needs attention" value={String(summary?.dueForRevision ?? 0).padStart(2, '0')} detail="leases due for revision" icon={ClipboardList} accent="bg-[hsl(var(--chart-4))]" trend={summary?.dueForRevision ? 'down' : undefined} /></div></section>
    <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <Surface className="p-5 sm:p-6"><SectionTitle eyebrow="Setup / 01" title="Make your workspace useful" aside={<Sparkles size={18} className="text-[hsl(var(--primary))]" />} /><p className="mb-6 max-w-[500px] text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">Start with the places you manage, then add the people and leases inside them. PropFlow will keep the operational detail close at hand.</p><div className="space-y-2.5">{[{ done: properties.length > 0, title: 'Add your first property', description: properties.length ? `${properties.length} location${properties.length === 1 ? '' : 's'} in your portfolio` : 'Add all its units at the same time', action: onAddProperty }, { done: flats.length > 0, title: 'Add units', description: flats.length ? `${flats.length} unit${flats.length === 1 ? '' : 's'} being tracked` : 'Units can also be added one at a time later', action: () => onAddFlat() }, { done: flats.some((flat) => flat.isOccupied), title: 'Map a tenant to a unit', description: flats.some((flat) => flat.isOccupied) ? `${flats.filter((flat) => flat.isOccupied).length} unit${flats.filter((flat) => flat.isOccupied).length === 1 ? '' : 's'} occupied` : 'Pick a vacant unit from the dropdown', action: () => onAssignTenant() }, { done: flats.some((flat) => flat.lastPaymentDate), title: 'Record a payment', description: flats.some((flat) => flat.lastPaymentDate) ? 'Your ledger has a payment trail' : 'Close the loop on your first rent', action: () => flats.find((flat) => flat.isOccupied) && onSelectFlat(flats.find((flat) => flat.isOccupied)!) }].map((item, index) => <button type="button" key={item.title} onClick={item.action} data-testid={`button-setup-${index}`} className="group flex w-full items-center gap-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--background)/.45)] p-3 text-left transition-colors hover:border-[hsl(var(--primary)/.55)] hover:bg-[hsl(var(--primary)/.05)]"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${item.done ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}>{item.done ? <Check size={14} /> : `0${index + 1}`}</span><span className="min-w-0 flex-1"><span className="block text-[12px] font-bold">{item.title}</span><span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--muted-foreground))]">{item.description}</span></span><ChevronRight size={16} className="text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" /></button>)}</div></Surface>
      <ActivityPanel activities={activities} />
    </section>
    <section><SectionTitle eyebrow="Portfolio / 02" title="Properties" aside={<button type="button" onClick={onAddProperty} data-testid="button-add-property" className="flex items-center gap-1.5 rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-[11px] font-bold transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"><Plus size={14} />New property</button>} />{properties.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{properties.map((property) => <PropertyCard key={property.id} property={property} flats={flats.filter((flat) => flat.propertyId === property.id)} onEdit={() => onEditProperty(property)} onDelete={() => onDeleteProperty(property)} onAddFlat={() => onAddFlat(property.id)} onAssignTenant={() => onAssignTenant(property.id)} onSelectFlat={onSelectFlat} />)}</div> : <EmptyState title="Your portfolio starts here" description="Add a property to see occupancy, rent and tenant details come together." action={<button type="button" onClick={onAddProperty} data-testid="button-empty-add-property" className="rounded-[9px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))]"><Plus size={14} className="mr-1.5 inline" />Add first property</button>} />}</section>
  </div>;
}

function ActivityPanel({ activities }: { activities: { id: string; type: string; title: string; description: string; createdAt: string }[] }) {
  return <Surface className="p-5 sm:p-6"><SectionTitle eyebrow="Signal / 03" title="Recent activity" aside={<Activity size={18} className="text-[hsl(var(--accent))]" />} />{activities.length ? <div className="space-y-0.5">{activities.slice(0, 5).map((item) => <div key={item.id} data-testid={`activity-${item.id}`} className="flex gap-3 border-b border-[hsl(var(--border)/.7)] py-3 last:border-0"><div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.type === 'payment' ? 'bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary-foreground))]' : item.type === 'tenant' ? 'bg-[hsl(var(--chart-3)/.15)] text-[hsl(var(--chart-3))]' : 'bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent-foreground))]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" /></div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold">{item.title}</p><p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">{item.description}</p></div><span className="mono shrink-0 pt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">{formatDate(item.createdAt)}</span></div>)}</div> : <EmptyState title="A quiet start" description="Property and payment events will show up here." />}</Surface>;
}

function PropertyCard({ property, flats, onEdit, onDelete, onAddFlat, onAssignTenant, onSelectFlat }: { property: Property; flats: Flat[]; onEdit: () => void; onDelete: () => void; onAddFlat: () => void; onAssignTenant: () => void; onSelectFlat: (flat: Flat) => void }) {
  const collected = flats.reduce((sum, flat) => sum + flat.totalPaid, 0);
  const occupiedCount = flats.filter((flat) => flat.isOccupied).length;
  const vacantCount = flats.length - occupiedCount;
  return <Surface className="group overflow-hidden transition-transform duration-300 hover:-translate-y-1"><div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] px-5 pb-5 pt-4 text-[hsl(var(--sidebar-foreground))]"><div className="mb-5 flex items-start justify-between"><span className="mono rounded-full bg-[hsl(var(--sidebar-primary)/.16)] px-2 py-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--sidebar-primary))]">Property</span><div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"><button type="button" onClick={onEdit} data-testid={`button-edit-property-${property.id}`} className="rounded-md p-1.5 text-[hsl(var(--sidebar-foreground)/.65)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"><Pencil size={13} /></button><button type="button" onClick={onDelete} data-testid={`button-delete-property-${property.id}`} className="rounded-md p-1.5 text-[hsl(var(--sidebar-foreground)/.65)] hover:bg-[hsl(var(--destructive)/.2)] hover:text-[hsl(var(--destructive))]"><Trash2 size={13} /></button></div></div><h3 className="display truncate text-[17px] font-semibold tracking-[-.04em]">{property.name}</h3><p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-[hsl(var(--sidebar-foreground)/.56)]"><Building2 size={12} />{property.address}</p></div><div className="p-4"><div className="mb-3 grid grid-cols-3 divide-x divide-[hsl(var(--border))]"><div><p className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Units</p><p className="mt-1 text-[15px] font-bold">{property.unitCount}<span className="font-normal text-[10px] text-[hsl(var(--muted-foreground))]"> · {vacantCount} vacant</span></p></div><div className="pl-3"><p className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Occupancy</p><p className="mt-1 text-[15px] font-bold">{property.unitCount ? Math.round(occupiedCount / property.unitCount * 100) : 0}%</p></div><div className="pl-3"><p className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Collected</p><p className="mt-1 truncate text-[15px] font-bold">{formatMoney(collected)}</p></div></div>{flats.length ? <div className="mb-3 flex flex-wrap gap-1.5">{flats.slice(0, 3).map((flat) => <button key={flat.id} type="button" onClick={() => onSelectFlat(flat)} data-testid={`button-flat-${flat.id}`} className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors hover:border-[hsl(var(--primary))] ${flat.isOccupied ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}>{flat.flatNo}{flat.isOccupied ? ` · ${flat.tenantName!.split(' ')[0]}` : ' · Vacant'}</button>)}{flats.length > 3 && <span className="px-1 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">+{flats.length - 3} more</span>}</div> : <p className="mb-3 text-[11px] text-[hsl(var(--muted-foreground))]">No units added yet.</p>}<div className="flex gap-2"><button type="button" onClick={onAddFlat} data-testid={`button-add-flat-${property.id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[hsl(var(--border))] py-2 text-[11px] font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.06)] hover:text-[hsl(var(--primary-foreground))]"><Plus size={13} />Add unit</button>{vacantCount > 0 && <button type="button" onClick={onAssignTenant} data-testid={`button-assign-tenant-${property.id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[hsl(var(--border))] py-2 text-[11px] font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.06)] hover:text-[hsl(var(--primary-foreground))]"><UserPlus size={13} />Assign tenant</button>}</div></div></Surface>;
}

function Ledger({ flats, allFlats, properties, search, onSearch, propertyFilter, onPropertyFilter, onAddFlat, onEditFlat, onDeleteFlat, onRecordPayment, onSelectFlat, onResolveExpired, onAssignTenant, onVacate }: { flats: Flat[]; allFlats: Flat[]; properties: Property[]; search: string; onSearch: (value: string) => void; propertyFilter: string; onPropertyFilter: (value: string) => void; onAddFlat: () => void; onEditFlat: (flat: Flat) => void; onDeleteFlat: (flat: Flat) => void; onRecordPayment: (flat: Flat) => void; onSelectFlat: (flat: Flat) => void; onResolveExpired: (flat: Flat) => void; onAssignTenant: () => void; onVacate: (flat: Flat) => void }) {
  const hasVacant = allFlats.some((flat) => !flat.isOccupied);
  return <div className="animate-rise-in space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mono mb-1 text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Collections / live view</p><h2 className="display text-[26px] font-semibold tracking-[-.055em]">Rent ledger</h2><p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">{allFlats.length} unit{allFlats.length === 1 ? '' : 's'} across {properties.length} propert{properties.length === 1 ? 'y' : 'ies'}.</p></div><div className="flex gap-2">{hasVacant && <button type="button" onClick={onAssignTenant} data-testid="button-ledger-assign-tenant" className="flex items-center justify-center gap-2 rounded-[9px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-[12px] font-bold transition-colors hover:border-[hsl(var(--primary))]"><UserPlus size={15} />Assign tenant</button>}<button type="button" onClick={onAddFlat} data-testid="button-ledger-add-flat" className="flex items-center justify-center gap-2 rounded-[9px] bg-[hsl(var(--primary))] px-3.5 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5"><Plus size={15} />Add unit</button></div></div><Surface className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] p-4 sm:flex-row"><div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" /><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search tenant, unit or property" data-testid="input-ledger-search" className={`${inputClass()} pl-9`} /></div><select value={propertyFilter} onChange={(event) => onPropertyFilter(event.target.value)} data-testid="select-ledger-property" className={`${inputClass()} sm:w-[190px]`}><option value="all">All properties</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div>{flats.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-[hsl(var(--border))] text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><th className="px-5 py-3 font-semibold">Unit / tenant</th><th className="px-3 py-3 font-semibold">Monthly rent</th><th className="px-3 py-3 font-semibold">Collected</th><th className="px-3 py-3 font-semibold">Last payment</th><th className="px-3 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody>{flats.map((flat) => <LedgerRow key={flat.id} flat={flat} onEdit={() => onEditFlat(flat)} onDelete={() => onDeleteFlat(flat)} onPay={() => onRecordPayment(flat)} onSelect={() => onSelectFlat(flat)} onResolve={() => onResolveExpired(flat)} onAssignTenant={onAssignTenant} onVacate={() => onVacate(flat)} />)}</tbody></table></div> : <div className="p-5"><EmptyState title={allFlats.length ? 'No matching units' : 'The ledger is ready'} description={allFlats.length ? 'Try a different search or property filter.' : 'Add a unit to begin tracking rent and payment history.'} action={!allFlats.length ? <button type="button" onClick={onAddFlat} data-testid="button-empty-ledger-add-flat" className="rounded-[9px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))]"><Plus size={14} className="mr-1.5 inline" />Add first unit</button> : undefined} /></div>}</Surface></div>;
}

function LedgerRow({ flat, onEdit, onDelete, onPay, onSelect, onResolve, onAssignTenant, onVacate }: { flat: Flat; onEdit: () => void; onDelete: () => void; onPay: () => void; onSelect: () => void; onResolve: () => void; onAssignTenant: () => void; onVacate: () => void }) {
  const paidThisCycle = flat.lastPaymentDate && new Date(flat.lastPaymentDate).getMonth() === new Date().getMonth();
  return <tr data-testid={`row-ledger-${flat.id}`} className="group border-b border-[hsl(var(--border)/.7)] last:border-0 transition-colors hover:bg-[hsl(var(--muted)/.38)]"><td className="px-5 py-4"><button type="button" onClick={onSelect} data-testid={`button-open-flat-${flat.id}`} className="flex items-center gap-3 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[hsl(var(--sidebar))] text-[11px] font-bold text-[hsl(var(--sidebar-primary))]">{flat.flatNo.slice(-3)}</span><span><span className="block text-[12px] font-bold">{flat.tenantName ?? 'Vacant'}</span><span className="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]">{flat.propertyName} · {flat.flatNo}</span></span></button></td><td className="px-3 py-4 mono text-[12px] font-medium">{flat.rent != null ? formatMoney(flat.rent) : '—'}</td><td className="px-3 py-4 mono text-[12px] font-medium">{formatMoney(flat.totalPaid)}</td><td className="px-3 py-4 text-[11px] text-[hsl(var(--muted-foreground))]">{formatDate(flat.lastPaymentDate, true)}</td><td className="px-3 py-4">{!flat.isOccupied ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-bold text-[hsl(var(--muted-foreground))]"><span className="h-1.5 w-1.5 rounded-full bg-current" />Vacant</span> : flat.isExpired ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--destructive)/.14)] px-2 py-1 text-[10px] font-bold text-[hsl(var(--destructive))]"><span className="h-1.5 w-1.5 rounded-full bg-current" />Expired</span> : <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${paidThisCycle ? 'bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent-foreground))]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{paidThisCycle ? 'Paid' : 'Due'}</span>}</td><td className="px-5 py-4"><div className="flex justify-end gap-1">{!flat.isOccupied ? <button type="button" onClick={onAssignTenant} data-testid={`button-assign-tenant-flat-${flat.id}`} className="rounded-[7px] bg-[hsl(var(--primary)/.13)] px-2.5 py-1.5 text-[10px] font-bold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary)/.24)]">Assign tenant</button> : flat.isExpired ? <button type="button" onClick={onResolve} data-testid={`button-resolve-flat-${flat.id}`} className="rounded-[7px] bg-[hsl(var(--destructive)/.13)] px-2.5 py-1.5 text-[10px] font-bold text-[hsl(var(--destructive))] transition-colors hover:bg-[hsl(var(--destructive)/.22)]">Resolve</button> : <button type="button" onClick={onPay} data-testid={`button-record-payment-${flat.id}`} className="rounded-[7px] bg-[hsl(var(--primary)/.13)] px-2.5 py-1.5 text-[10px] font-bold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary)/.24)]">Record payment</button>}{flat.isOccupied && <button type="button" onClick={onVacate} data-testid={`button-vacate-flat-${flat.id}`} title="Vacate unit" className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><UserMinus size={14} /></button>}<button type="button" onClick={onEdit} data-testid={`button-edit-flat-${flat.id}`} className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"><Pencil size={14} /></button><button type="button" onClick={onDelete} data-testid={`button-delete-flat-${flat.id}`} title="Delete unit" className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"><Trash2 size={14} /></button></div></td></tr>;
}

function FlatDetail({ flat, payments, loading, onClose, onEdit, onRecordPayment, onResolveExpired, onAssignTenant, onVacate, onDeleteUnit }: { flat: Flat; payments: { id: string; paymentDate: string; amount: number }[]; loading: boolean; onClose: () => void; onEdit: () => void; onRecordPayment: () => void; onResolveExpired: () => void; onAssignTenant: () => void; onVacate: () => void; onDeleteUnit: () => void }) {
  return <div className="fixed inset-0 z-30 flex justify-end bg-[hsl(var(--foreground)/.22)] backdrop-blur-[1px]"><section className="animate-rise-in h-full w-full max-w-[420px] overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[-20px_0_60px_hsl(var(--foreground)/.12)] sm:p-7"><div className="mb-8 flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Unit detail</p><h2 className="display mt-1 text-[24px] font-semibold tracking-[-.05em]">{flat.flatNo}</h2></div><button type="button" onClick={onClose} data-testid="button-close-flat-detail" className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={17} /></button></div>{flat.isExpired && <div data-testid="badge-detail-expired" className="mb-4 flex items-center gap-2 rounded-[9px] bg-[hsl(var(--destructive)/.12)] px-3.5 py-2.5 text-[11px] font-bold text-[hsl(var(--destructive))]"><span className="h-1.5 w-1.5 rounded-full bg-current" />Lease expired {formatDate(flat.tenureEnd, true)}</div>}{flat.isOccupied ? <div className="rounded-[13px] bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))]"><p className="text-[16px] font-bold">{flat.tenantName}</p><p className="mt-1 text-[11px] text-[hsl(var(--sidebar-foreground)/.58)]">{flat.propertyName} · {flat.workplace || 'Workplace not added'}</p><div className="mt-6 grid grid-cols-2 gap-4"><div><p className="mono text-[9px] uppercase text-[hsl(var(--sidebar-foreground)/.46)]">Monthly rent</p><p className="mt-1 display text-[20px] font-semibold text-[hsl(var(--sidebar-primary))]">{formatMoney(flat.rent ?? undefined)}</p></div><div><p className="mono text-[9px] uppercase text-[hsl(var(--sidebar-foreground)/.46)]">Total paid</p><p className="mt-1 display text-[20px] font-semibold">{formatMoney(flat.totalPaid)}</p></div></div></div> : <div className="rounded-[13px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.25)] p-5 text-center"><p className="text-[13px] font-bold">Vacant unit</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{flat.propertyName} · No tenant currently mapped to this unit.</p></div>}<div className="mt-4 flex gap-2">{!flat.isOccupied ? <button type="button" onClick={onAssignTenant} data-testid="button-detail-assign-tenant" className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[hsl(var(--primary))] py-2.5 text-[11px] font-bold text-[hsl(var(--primary-foreground))]"><UserPlus size={14} />Assign tenant</button> : flat.isExpired ? <button type="button" onClick={onResolveExpired} data-testid="button-detail-resolve" className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[hsl(var(--destructive))] py-2.5 text-[11px] font-bold text-[hsl(var(--destructive-foreground))]">Resolve lease</button> : <button type="button" onClick={onRecordPayment} data-testid="button-detail-record-payment" className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[hsl(var(--primary))] py-2.5 text-[11px] font-bold text-[hsl(var(--primary-foreground))]"><Plus size={14} />Record payment</button>}<button type="button" onClick={onEdit} data-testid="button-detail-edit-flat" className="flex items-center justify-center gap-1.5 rounded-[8px] border border-[hsl(var(--border))] px-3 py-2.5 text-[11px] font-bold">{flat.isOccupied ? <><Pencil size={14} />Edit tenant</> : <><Pencil size={14} />Edit unit</>}</button>{flat.isOccupied && <button type="button" onClick={onVacate} data-testid="button-detail-vacate" title="Vacate unit - clears the tenant but keeps the unit" className="flex items-center justify-center gap-1.5 rounded-[8px] border border-[hsl(var(--border))] px-3 py-2.5 text-[11px] font-bold text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--destructive)/.4)] hover:text-[hsl(var(--destructive))]"><UserMinus size={14} />Vacate</button>}</div><button type="button" onClick={onDeleteUnit} data-testid="button-detail-delete-unit" className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[8px] py-2 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"><Trash2 size={13} />Delete unit</button><div className="mt-8"><SectionTitle eyebrow="Payment history" title="Recent payments" />{loading ? <SkeletonRows rows={3} /> : payments.length ? <div className="space-y-2">{payments.map((payment) => <div key={payment.id} data-testid={`payment-${payment.id}`} className="flex items-center justify-between rounded-[9px] border border-[hsl(var(--border))] px-3.5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary-foreground))]"><CircleDollarSign size={14} /></span><span className="text-[11px] font-semibold">{formatDate(payment.paymentDate, true)}</span></div><span className="mono text-[12px] font-medium">{formatMoney(payment.amount)}</span></div>)}</div> : <EmptyState title="No payments yet" description="Record the first rent payment for this unit." />}</div>{flat.isOccupied && <div className="mt-8 border-t border-[hsl(var(--border))] pt-5"><div className="flex justify-between text-[11px]"><span className="text-[hsl(var(--muted-foreground))]">Move-in date</span><span className="font-semibold">{formatDate(flat.moveInDate, true)}</span></div><div className="mt-3 flex justify-between text-[11px]"><span className="text-[hsl(var(--muted-foreground))]">Tenure ends</span><span className={`font-semibold ${flat.isExpired ? 'text-[hsl(var(--destructive))]' : ''}`}>{formatDate(flat.tenureEnd, true)}</span></div><div className="mt-3 flex justify-between text-[11px]"><span className="text-[hsl(var(--muted-foreground))]">Security deposit</span><span className="mono font-medium">{formatMoney(flat.deposit ?? undefined)}</span></div></div>}</section></div>;
}

type PropertyFormState = { name: string; address: string; unitNumbers: string[] };

function PropertyModal({ open, editing, form, setForm, onClose, onSubmit, pending }: { open: boolean; editing: Property | null; form: PropertyFormState; setForm: (form: PropertyFormState) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean }) {
  const updateUnit = (index: number, value: string) => setForm({ ...form, unitNumbers: form.unitNumbers.map((unit, i) => (i === index ? value : unit)) });
  const addUnit = () => setForm({ ...form, unitNumbers: [...form.unitNumbers, ''] });
  const removeUnit = (index: number) => setForm({ ...form, unitNumbers: form.unitNumbers.filter((_, i) => i !== index) });
  return <Modal open={open} title={editing ? 'Edit property' : 'Add a property'} description={editing ? 'A clear name and address is all you need to begin.' : 'Add every unit on this property now - tenants get mapped to them later.'} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><Field label="Property name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="input-property-name" className={inputClass()} placeholder="e.g. Palm Grove Apartments" /></Field><Field label="Address"><input required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} data-testid="input-property-address" className={inputClass()} placeholder="Street, locality, city" /></Field>{!editing && <Field label="Units" hint="Add a row for every unit in this property. You can add more later.">
    <div className="space-y-2">
      {form.unitNumbers.map((unit, index) => <div key={index} className="flex gap-2">
        <input value={unit} onChange={(event) => updateUnit(index, event.target.value)} data-testid={`input-property-unit-${index}`} className={inputClass()} placeholder={`Unit ${index + 1}, e.g. A-${101 + index}`} />
        {form.unitNumbers.length > 1 && <button type="button" onClick={() => removeUnit(index)} data-testid={`button-remove-property-unit-${index}`} aria-label="Remove unit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--destructive)/.4)] hover:text-[hsl(var(--destructive))]"><X size={15} /></button>}
      </div>)}
      <button type="button" onClick={addUnit} data-testid="button-add-property-unit" className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[hsl(var(--border))] py-2 text-[11px] font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"><Plus size={13} />Add another unit</button>
    </div>
  </Field>}<div className="flex justify-end gap-2 pt-3"><button type="button" onClick={onClose} data-testid="button-cancel-property" className="rounded-[8px] px-3.5 py-2.5 text-[12px] font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button><button type="submit" disabled={pending} data-testid="button-submit-property" className="rounded-[8px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{pending ? 'Saving...' : editing ? 'Save changes' : 'Add property'}</button></div></form></Modal>;
}

function TenureField({ startDate, endDate, onChange, testId }: { startDate: string; endDate: string; onChange: (startDate: string, endDate: string) => void; testId: string }) {
  const range: DateRange | undefined = startDate || endDate
    ? { from: parseLocalDate(startDate), to: parseLocalDate(endDate) }
    : undefined;
  const label = startDate && endDate
    ? `${formatDate(startDate, true)} – ${formatDate(endDate, true)}`
    : startDate ? `${formatDate(startDate, true)} – pick end date` : 'Pick tenure dates';

  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" data-testid={testId} className={`${inputClass()} flex items-center justify-between gap-2 text-left`}>
        <span className={startDate && endDate ? '' : 'text-[hsl(var(--muted-foreground))]'}>{label}</span>
        <CalendarRange size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar
        mode="range"
        numberOfMonths={2}
        defaultMonth={range?.from}
        selected={range}
        onSelect={(next) => onChange(next?.from ? toLocalDateString(next.from) : '', next?.to ? toLocalDateString(next.to) : '')}
      />
    </PopoverContent>
  </Popover>;
}

function FlatModal({ open, editing, form, setForm, properties, onClose, onSubmit, pending }: { open: boolean; editing: Flat | null; form: { propertyId: string; flatNo: string }; setForm: (form: { propertyId: string; flatNo: string }) => void; properties: Property[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean }) {
  return <Modal open={open} title={editing ? 'Edit unit' : 'Add a unit'} description="A unit needs just a number - map a tenant to it whenever it's occupied." onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><Field label="Property"><select required disabled={!!editing} value={form.propertyId} onChange={(event) => setForm({ ...form, propertyId: event.target.value })} data-testid="select-flat-property" className={inputClass()}><option value="">Choose a property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></Field><Field label="Unit number"><input required value={form.flatNo} onChange={(event) => setForm({ ...form, flatNo: event.target.value })} data-testid="input-flat-number" className={inputClass()} placeholder="A-204" /></Field><div className="flex justify-end gap-2 pt-3"><button type="button" onClick={onClose} data-testid="button-cancel-flat" className="rounded-[8px] px-3.5 py-2.5 text-[12px] font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button><button type="submit" disabled={pending || !properties.length} data-testid="button-submit-flat" className="rounded-[8px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{pending ? 'Saving...' : editing ? 'Save changes' : 'Add unit'}</button></div></form></Modal>;
}

type TenantFormState = { flatId: string; tenantName: string; workplace: string; govtId: string; moveInDate: string; tenureEnd: string; deposit: string; rent: string };

function TenantModal({ open, editing, form, setForm, vacantFlats, onClose, onSubmit, pending }: { open: boolean; editing: Flat | null; form: TenantFormState; setForm: (form: TenantFormState) => void; vacantFlats: Flat[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean }) {
  const targetFlat = editing ?? vacantFlats.find((flat) => flat.id === form.flatId);
  return <Modal open={open} title={editing ? 'Edit tenant' : 'Assign a tenant'} description={editing ? `${editing.propertyName} · ${editing.flatNo}` : 'Pick a vacant unit and map the tenant to it.'} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4">{!editing && <Field label="Unit"><select required value={form.flatId} onChange={(event) => setForm({ ...form, flatId: event.target.value })} data-testid="select-tenant-flat" className={inputClass()}><option value="">Choose a vacant unit</option>{vacantFlats.map((flat) => <option key={flat.id} value={flat.id}>{flat.propertyName} · {flat.flatNo}</option>)}</select></Field>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Tenant name"><input required value={form.tenantName} onChange={(event) => setForm({ ...form, tenantName: event.target.value })} data-testid="input-tenant-name" className={inputClass()} placeholder="Tenant's full name" /></Field><Field label="Monthly rent"><input required min="0" type="number" value={form.rent} onChange={(event) => setForm({ ...form, rent: event.target.value })} data-testid="input-flat-rent" className={inputClass()} placeholder="25000" /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Security deposit"><input min="0" type="number" value={form.deposit} onChange={(event) => setForm({ ...form, deposit: event.target.value })} data-testid="input-flat-deposit" className={inputClass()} placeholder="50000" /></Field><Field label="Workplace"><input value={form.workplace} onChange={(event) => setForm({ ...form, workplace: event.target.value })} data-testid="input-tenant-workplace" className={inputClass()} placeholder="Optional" /></Field></div><Field label="Tenure" hint="Move-in date to lease end date"><TenureField testId="button-tenure-range" startDate={form.moveInDate} endDate={form.tenureEnd} onChange={(moveInDate, tenureEnd) => setForm({ ...form, moveInDate, tenureEnd })} /></Field><Field label="Government ID" hint="Stored only for your records"><input value={form.govtId} onChange={(event) => setForm({ ...form, govtId: event.target.value })} data-testid="input-tenant-govt-id" className={inputClass()} placeholder="Optional ID reference" /></Field><div className="flex justify-end gap-2 pt-3"><button type="button" onClick={onClose} data-testid="button-cancel-tenant" className="rounded-[8px] px-3.5 py-2.5 text-[12px] font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button><button type="submit" disabled={pending || !targetFlat || !form.moveInDate || !form.tenureEnd} data-testid="button-submit-tenant" className="rounded-[8px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{pending ? 'Saving...' : editing ? 'Save changes' : 'Assign tenant'}</button></div></form></Modal>;
}

function ExpiredLeaseModal({ flat, form, setForm, onClose, onSubmitRenew, onVacate, renewPending }: { flat: Flat | null; form: { tenureEnd: string; rent: string }; setForm: (form: { tenureEnd: string; rent: string }) => void; onClose: () => void; onSubmitRenew: (event: FormEvent<HTMLFormElement>) => void; onVacate: () => void; renewPending: boolean }) {
  if (!flat) return null;
  return <Modal open={!!flat} title="Lease expired" description={`${flat.tenantName} · ${flat.flatNo} · tenure ended ${formatDate(flat.tenureEnd, true)}`} onClose={onClose}>
    <div className="space-y-5">
      <p className="text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">This tenant's lease has ended. Renew with a new tenure end date (and rent, if it's changing), or vacate the unit for the next tenant.</p>
      <form onSubmit={onSubmitRenew} className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] p-4">
        <p className="text-[12px] font-bold">Renew lease</p>
        <Field label="New rent"><input required min="0" type="number" value={form.rent} onChange={(event) => setForm({ ...form, rent: event.target.value })} data-testid="input-renew-rent" className={inputClass()} /></Field>
        <Field label="New tenure end date"><input required type="date" min={flat.tenureEnd?.slice(0, 10)} value={form.tenureEnd} onChange={(event) => setForm({ ...form, tenureEnd: event.target.value })} data-testid="input-renew-tenure-end" className={inputClass()} /></Field>
        <button type="submit" disabled={renewPending} data-testid="button-submit-renew" className="w-full rounded-[8px] bg-[hsl(var(--primary))] py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{renewPending ? 'Renewing...' : 'Renew lease'}</button>
      </form>
      <button type="button" onClick={onVacate} data-testid="button-expired-vacate" className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-[hsl(var(--destructive)/.3)] py-2.5 text-[12px] font-bold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)]"><UserMinus size={14} />Vacate unit instead</button>
    </div>
  </Modal>;
}

function PaymentModal({ open, flat, form, setForm, onClose, onSubmit, pending }: { open: boolean; flat: Flat | null; form: { paymentDate: string; amount: string }; setForm: (form: { paymentDate: string; amount: string }) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean }) {
  return <Modal open={open} title="Record a payment" description={flat ? `${flat.tenantName} · ${flat.flatNo}` : undefined} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><Field label="Amount received"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[hsl(var(--muted-foreground))]">₹</span><input required min="0" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} data-testid="input-payment-amount" className={`${inputClass()} pl-8`} /></div></Field><Field label="Payment date"><input required type="date" value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} data-testid="input-payment-date" className={inputClass()} /></Field><div className="rounded-[9px] bg-[hsl(var(--primary)/.1)] p-3 text-[11px] leading-5 text-[hsl(var(--primary-foreground))]">This payment will be added to the unit's history and reflected in your portfolio totals.</div><div className="flex justify-end gap-2 pt-3"><button type="button" onClick={onClose} data-testid="button-cancel-payment" className="rounded-[8px] px-3.5 py-2.5 text-[12px] font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Cancel</button><button type="submit" disabled={pending} data-testid="button-submit-payment" className="rounded-[8px] bg-[hsl(var(--primary))] px-4 py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{pending ? 'Recording...' : 'Record payment'}</button></div></form></Modal>;
}

function AuthGate() {
  const queryClient = useQueryClient();
  const statusQuery = useGetAuthStatus();
  const meQuery = useGetMe({
    query: { enabled: statusQuery.data?.hasOwner === true, retry: false, queryKey: getGetMeQueryKey() },
  });

  if (statusQuery.isLoading) return <AuthShell><SkeletonRows rows={3} /></AuthShell>;
  if (statusQuery.isError) return <AuthShell><ErrorState onRetry={() => statusQuery.refetch()} /></AuthShell>;
  // isLoading alone misses the case where data was just removed from the
  // cache (e.g. on logout) but a refetch hasn't started yet - treat "no
  // data at all" as still-resolving too, so this doesn't briefly read as
  // "confirmed no owner" and flash the setup screen.
  if (statusQuery.data === undefined) return <AuthShell><SkeletonRows rows={3} /></AuthShell>;

  if (statusQuery.data.hasOwner !== true) {
    return <SetupScreen onDone={() => {
      queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    }} />;
  }

  if (meQuery.isLoading) return <AuthShell><SkeletonRows rows={3} /></AuthShell>;

  if (meQuery.isError || !meQuery.data) {
    return <LoginScreen onDone={() => queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() })} />;
  }

  return <AppShell owner={meQuery.data} />;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="noise flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><Building2 size={19} strokeWidth={2.5} /></div>
          <div><p className="display text-[18px] font-bold tracking-[-.06em]">PropFlow</p><p className="mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">operator workspace</p></div>
        </div>
        {children}
      </div>
    </div>
  );
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', pin: '' });
  const [error, setError] = useState<string | null>(null);
  const setup = useSetupOwner();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setup.mutate({ data: form }, {
      onSuccess: onDone,
      onError: () => setError('Could not create your account. Please try again.'),
    });
  };

  return <AuthShell>
    <Surface className="p-6 sm:p-8">
      <h1 className="display text-[22px] font-semibold tracking-[-.04em]">Set up your workspace</h1>
      <p className="mt-1.5 text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">Create the owner account for this PropFlow workspace. You'll use this PIN to log in from now on.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Your name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="input-setup-name" className={inputClass()} placeholder="Aarav Shah" /></Field>
        <Field label="PIN" hint="4 digits"><input required type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} data-testid="input-setup-pin" className={inputClass()} placeholder="••••" /></Field>
        {error && <p className="text-[12px] font-semibold text-[hsl(var(--destructive))]">{error}</p>}
        <button type="submit" disabled={setup.isPending} data-testid="button-submit-setup" className="w-full rounded-[9px] bg-[hsl(var(--primary))] py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{setup.isPending ? 'Creating account...' : 'Create account'}</button>
      </form>
    </Surface>
  </AuthShell>;
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    login.mutate({ data: { pin } }, {
      onSuccess: onDone,
      onError: (err) => {
        setPin('');
        setError(
          err instanceof ApiError && typeof err.data === 'object' && err.data && 'error' in err.data
            ? String((err.data as { error: unknown }).error)
            : 'Incorrect PIN.',
        );
      },
    });
  };

  return <AuthShell>
    <Surface className="p-6 sm:p-8">
      <h1 className="display text-[22px] font-semibold tracking-[-.04em]">Welcome back</h1>
      <p className="mt-1.5 text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">Enter your PIN to log in to your PropFlow workspace.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="PIN"><input required autoFocus type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} data-testid="input-login-pin" className={inputClass()} /></Field>
        {error && <p className="text-[12px] font-semibold text-[hsl(var(--destructive))]">{error}</p>}
        <button type="submit" disabled={login.isPending} data-testid="button-submit-login" className="w-full rounded-[9px] bg-[hsl(var(--primary))] py-2.5 text-[12px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{login.isPending ? 'Logging in...' : 'Log in'}</button>
      </form>
    </Surface>
  </AuthShell>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={AuthGate} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;