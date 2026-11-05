from spotbot.config import Settings
from spotbot.storage.common import Storage


def create_store(settings: Settings) -> Storage:
    if settings.spotbot_storage_backend == "mysql":
        from spotbot.storage.mysql import MySQLStore

        return MySQLStore(settings.spotbot_mysql_url.get_secret_value())
    if settings.spotbot_storage_backend == "dynamodb":
        from spotbot.storage.dynamodb import DynamoDBStore

        return DynamoDBStore(
            settings.spotbot_dynamodb_table,
            region=settings.spotbot_dynamodb_region,
            endpoint_url=settings.spotbot_dynamodb_endpoint_url or None,
            create_table=settings.spotbot_dynamodb_create_table,
        )
    from spotbot.storage.sqlite import Store

    return Store(settings.spotbot_database_path)
