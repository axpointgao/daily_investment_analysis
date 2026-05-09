import type React from 'react';
import { useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button, Input } from '../components/common';
import type { ParsedApiError } from '../api/error';
import { isParsedApiError } from '../api/error';
import { useAuth } from '../hooks';
import { SettingsAlert } from '../components/settings';

const LOGO_SRC = '/dsa-logo.svg';

const LoginPage: React.FC = () => {
  const { login, passwordSet, setupState } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') ?? '';
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | ParsedApiError | null>(null);

  const isFirstTime = setupState === 'no_password' || !passwordSet;

  useEffect(() => {
    document.title = '登录 - DSA';
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isFirstTime && password !== passwordConfirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(password, isFirstTime ? passwordConfirm : undefined);
      if (result.success) {
        navigate(redirect, { replace: true });
      } else {
        setError(result.error ?? '登录失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isFirstTime ? <ShieldCheck className="size-5" /> : <Lock className="size-5" />}
            {isFirstTime ? '设置初始密码' : '登录到工作台'}
          </CardTitle>
          <CardDescription>
            {isFirstTime
              ? '首次启用认证，请为系统工作台设置管理员密码。'
              : '请输入管理员密码以访问 DSA 工作台。'}
          </CardDescription>
          <CardAction>
            <img src={LOGO_SRC} alt="DSA" className="h-6 w-6" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              <Input
                id="password"
                type="password"
                allowTogglePassword
                iconType="password"
                label={isFirstTime ? '管理员密码' : '登录密码'}
                placeholder={isFirstTime ? '请设置 6 位以上密码' : '请输入密码'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                autoFocus
                autoComplete={isFirstTime ? 'new-password' : 'current-password'}
                required
              />

              {isFirstTime ? (
                <Input
                  id="passwordConfirm"
                  type="password"
                  allowTogglePassword
                  iconType="password"
                  label="确认密码"
                  placeholder="再次确认管理员密码"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                  required
                />
              ) : null}

              {error ? (
                <SettingsAlert
                  title={isFirstTime ? '配置失败' : '验证未通过'}
                  message={isParsedApiError(error) ? error.message : error}
                  variant="error"
                />
              ) : null}

              <Button type="submit" className="w-full" isLoading={isSubmitting}>
                {isFirstTime ? '完成设置并登录' : '登录'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export default LoginPage;
