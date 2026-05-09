import type React from 'react';
import { useEffect } from 'react';
import { Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/common';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = '页面未找到 - DSA';
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <div className="relative mb-8">
        <span className="text-8xl font-bold text-primary">
          404
        </span>
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-2">页面未找到</h1>
      <p className="text-muted-foreground mb-8">抱歉，您访问的页面不存在或已被移动</p>

      <Button
        type="button"
        onClick={() => navigate('/')}
      >
        <Home />
        返回首页
      </Button>
    </div>
  );
};

export default NotFoundPage;
