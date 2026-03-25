import AuthForm from '../components/auth/AuthForm';

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background p-6">
      <AuthForm />
    </div>
  );
}
