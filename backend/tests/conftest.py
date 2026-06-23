"""全局测试配置。

在任何 app 模块导入前设置必需的环境变量，避免 Settings() 初始化失败。
"""
import os

# pydantic-settings 的 Settings() 在模块级别被调用（app.infra.db），
# 必须在 import 之前设置这两个无默认值的必填字段。
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-for-unit-tests")
os.environ.setdefault("API_KEY_ENCRYPTION_KEY", "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMTIzNDU2Nzg=")
