import Link from "next/link";
import { Brand, Icon } from "@/components/icon";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link href="/" aria-label="Bloco, início">
          <Brand />
        </Link>
        <div className="auth-statement">
          <div className="paper-symbol">
            <Icon name="layers" size={76} />
          </div>
          <h2>
            Seu espaço.
            <br />
            No seu ritmo.
          </h2>
          <p>Um lugar para organizar ideias e trabalhar em conjunto.</p>
        </div>
        <p className="auth-foot">Uma ideia de cada vez.</p>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-content">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
