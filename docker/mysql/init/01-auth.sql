ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root123456';
CREATE USER IF NOT EXISTS 'zhipei'@'%' IDENTIFIED WITH mysql_native_password BY 'zhipei123456';
ALTER USER 'zhipei'@'%' IDENTIFIED WITH mysql_native_password BY 'zhipei123456';
FLUSH PRIVILEGES;
