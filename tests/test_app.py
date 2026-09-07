import logging

from app import create_app


def make_app(tmp_path):
    return create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.sqlite3"), "SECRET_KEY": "test"})


def test_initialization_and_normal_login(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        response = client.post("/login", data={"username": "alex", "password": "bluebird"})
        assert response.status_code == 200
        assert b"Level complete" in response.data
        assert b'href="/search"' in response.data


def test_login_page_shows_classroom_credentials_only_on_level_one(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        response = client.get("/login")
        assert b"CLASSROOM TRAINING CREDENTIAL" in response.data
        assert b"alex" in response.data
        assert b"bluebird" in response.data
        assert b"Fictional local-lab data only" in response.data
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        assert b"CLASSROOM TRAINING CREDENTIAL" not in client.get("/search").data


def test_each_level_shows_beginner_directions_without_answer_payloads(tmp_path):
    app = make_app(tmp_path)
    answer_payloads = (
        b"' OR '1'='1' --",
        b"' UNION SELECT username,password,'x' FROM users --",
        b"10001' OR '1'='1",
        b"1 OR 1=1",
    )
    with app.test_client() as client:
        pages = [client.get("/login")]
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        pages.append(client.get("/search"))
        client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        pages.append(client.get("/account-lookup"))
        client.post("/account-lookup", data={"account_number": "10001' OR '1'='1"})
        pages.append(client.get("/transfer"))

    for page in pages:
        assert page.status_code == 200
        assert b"START HERE" in page.data
        assert b"Before you submit" in page.data or b"Keep investigating" in page.data
        assert all(payload not in page.data for payload in answer_payloads)


def test_directions_remain_visible_with_failed_submission_hints(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        login = client.post("/login", data={"username": "nope", "password": "nope"})
        assert b"START HERE" in login.data and b"Unlocked hints" in login.data
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        search = client.post("/search", data={"term": "nope"})
        assert b"START HERE" in search.data and b"Unlocked hints" in search.data
        client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        client.post("/account-lookup", data={"account_number": "nope"})
        account = client.post("/account-lookup", data={"account_number": "nope"})
        assert b"Keep investigating" in account.data and b"Unlocked hints" in account.data


def test_level_one_injection_unlocks_level_two_and_exposes_action(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        response = client.post("/login", data={"username": "' OR '1'='1' -- ", "password": "anything"})
        assert response.status_code == 200
        assert b'href="/search"' in response.data
        assert client.get("/search").status_code == 200


def test_failed_login_does_not_unlock_level_two(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        response = client.post("/login", data={"username": "nope", "password": "nope"})
        assert b"That sign-in did not work" in response.data
        assert client.get("/search").status_code == 302


def test_later_levels_remain_locked_until_predecessor_is_complete(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        assert client.get("/account-lookup").status_code == 302
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        assert client.get("/account-lookup").status_code == 302
        client.post("/search", data={"term": "Horizon"})
        assert client.get("/account-lookup").status_code == 302
        client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        assert client.get("/account-lookup").status_code == 200
        assert client.get("/transfer").status_code == 302


def test_levels_unlock_in_order(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        assert client.get("/search").status_code == 302
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        assert client.get("/search").status_code == 200
        client.post("/search", data={"term": "Horizon"})
        assert client.get("/account-lookup").status_code == 302
        client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        assert client.get("/account-lookup").status_code == 200
        client.post("/account-lookup", data={"account_number": "10001' OR '1'='1"})
        assert client.get("/transfer").status_code == 200


def test_instructor_injection_examples_complete_each_level(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        login = client.post("/login", data={"username": "' OR '1'='1' -- ", "password": "anything"})
        assert b"Welcome, alex. Level complete." in login.data
        search = client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        assert b"The UNION lesson is complete" in search.data
        account = client.post("/account-lookup", data={"account_number": "10001' OR '1'='1"})
        assert b"condition evaluated TRUE. Level complete." in account.data
        transfer = client.post("/transfer", data={"source_account": "1 OR 1=1", "destination_account": "10002", "amount": "25"})
        assert b"no money moved. Level complete." in transfer.data


def test_hints_are_progressive_and_resettable(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        first = client.post("/login", data={"username": "nope", "password": "nope"})
        assert b"Unlocked hints (1/3)" in first.data
        client.post("/login", data={"username": "nope", "password": "nope"})
        client.post("/reset")
        fresh = client.post("/login", data={"username": "nope", "password": "nope"})
        assert b"Unlocked hints (1/3)" in fresh.data


def test_secret_traversal_rejected_and_access_logged(tmp_path, caplog):
    app = make_app(tmp_path)
    with app.test_client() as client, caplog.at_level(logging.WARNING):
        assert client.get("/secret-files/../app.py").status_code in (404, 308)
        response = client.get("/secret-files/super_secret_soc_report.txt", headers={"Accept": "application/json"}, environ_base={"REMOTE_ADDR": "127.0.0.9"})
        assert response.status_code == 200
        assert response.json["event"]["ip"] == "127.0.0.9"
        assert "super_secret_soc_report.txt" in caplog.text
        assert client.get("/secret-files/schema.sql").status_code == 404


def test_transfer_is_simulated_and_does_not_change_balance(tmp_path):
    app = make_app(tmp_path)
    with app.test_client() as client:
        client.post("/login", data={"username": "alex", "password": "bluebird"})
        client.post("/search", data={"term": "' UNION SELECT username,password,'x' FROM users -- "})
        client.post("/account-lookup", data={"account_number": "10001' OR '1'='1"})
        response = client.post("/transfer", data={"source_account": "1 OR 1=1", "destination_account": "10002", "amount": "25"})
        assert b"no money moved" in response.data
        with app.app_context():
            row = app.get_db().execute("SELECT balance FROM accounts WHERE id=1").fetchone()
            assert row[0] == 1200


def test_login_contains_intentional_raw_concatenation():
    source = open("app.py", encoding="utf-8").read()
    assert "INTENTIONAL VULNERABILITY" in source
    assert '" + username + "' in source
