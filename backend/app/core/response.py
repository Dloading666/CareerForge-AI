def ok(data=None, msg: str = "ok"):
    return {
        "code": 0,
        "msg": msg,
        "data": data,
    }


def error(msg: str, code: int = 400):
    return {
        "code": code,
        "msg": msg,
        "data": None,
    }
