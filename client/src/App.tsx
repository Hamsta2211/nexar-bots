import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth";
import Security from "@/pages/security";
import { ThemeProvider } from "@/components/theme";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Bots from "@/pages/bots";
import Chat from "@/pages/chat";
import Tasks from "@/pages/tasks";
import Settings from "@/pages/settings";
import Hosting from "@/pages/hosting";
import MyPc from "@/pages/pc";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/bots" component={Bots} />
      <Route path="/chat" component={Chat} />
      <Route path="/chat/:id" component={Chat} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/settings" component={Settings} />
      <Route path="/hosting" component={Hosting} />
      <Route path="/pc" component={MyPc} />
      <Route path="/security" component={Security} />
      <Route component={NotFound} />
    </Switch>
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
