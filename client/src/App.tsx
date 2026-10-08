import { lazy, Suspense } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth";
import { ThemeProvider } from "@/components/theme";
import NotFound from "@/pages/not-found";

// Seiten werden erst bei Bedarf geladen: schnellerer Start, flüssigeres Gefühl
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Bots = lazy(() => import("@/pages/bots"));
const Chat = lazy(() => import("@/pages/chat"));
const Voice = lazy(() => import("@/pages/voice"));
const Tasks = lazy(() => import("@/pages/tasks"));
const Settings = lazy(() => import("@/pages/settings"));
const Hosting = lazy(() => import("@/pages/hosting"));
const MyPc = lazy(() => import("@/pages/pc"));
const Security = lazy(() => import("@/pages/security"));

function AppRouter() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Lädt …</div>}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/bots" component={Bots} />
        <Route path="/chat" component={Chat} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/voice" component={Voice} />
        <Route path="/voice/:id" component={Voice} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/settings" component={Settings} />
        <Route path="/hosting" component={Hosting} />
        <Route path="/pc" component={MyPc} />
        <Route path="/security" component={Security} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const style = { "--sidebar-width": "15.5rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Router hook={useHashLocation}>
              <SidebarProvider style={style}>
                <div className="flex h-screen w-full">
                  <AppSidebar />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <header className="flex h-11 items-center border-b border-border px-3 md:hidden">
                      <SidebarTrigger data-testid="button-sidebar-toggle" />
                      <span className="ml-2 text-sm font-semibold">nexar.bots</span>
                    </header>
                    <main className="min-h-0 flex-1 overflow-auto">
                      <AppRouter />
                    </main>
                  </div>
                </div>
              </SidebarProvider>
            </Router>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
